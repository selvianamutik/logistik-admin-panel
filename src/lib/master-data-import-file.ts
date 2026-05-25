import ExcelJS from 'exceljs';

import type { MasterDataImportField, MasterDataImportTargetConfig } from './master-data-import-config';

export type ParsedMasterDataImportFile = {
  headers: string[];
  rows: Record<string, string>[];
};

export const MASTER_DATA_IMPORT_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const TEMPLATE_SHEET_NAME = 'Template';
const GUIDE_SHEET_NAME = 'Panduan';
const HEADER_ROW_NUMBER = 5;
const MAX_HEADER_SCAN_ROWS = 20;
const HEADER_FILL = 'FF0F766E';
const REQUIRED_FILL = 'FFFFF7D6';
const OPTIONAL_FILL = 'FFF8FAFC';
const BORDER_STYLE: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
};

function clampWidth(length: number) {
  return Math.min(Math.max(length + 3, 14), 42);
}

function normalizeHeader(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildKnownHeaderSet(config: MasterDataImportTargetConfig) {
  const known = new Set<string>();
  config.fields.forEach((field) => {
    known.add(normalizeHeader(field.key));
    known.add(normalizeHeader(field.label));
    field.aliases?.forEach((alias) => known.add(normalizeHeader(alias)));
  });
  return known;
}

function fieldGuideText(field: MasterDataImportField) {
  const details = [field.help, field.aliases?.length ? `Alias: ${field.aliases.join(', ')}` : ''].filter(Boolean);
  return details.join(' | ') || '-';
}

function applyTableCellStyle(cell: ExcelJS.Cell, fillArgb?: string) {
  cell.border = BORDER_STYLE;
  cell.alignment = { vertical: 'middle', wrapText: true };
  if (fillArgb) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
  }
}

function cellValueToText(value: ExcelJS.CellValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => cellValueToText(item as ExcelJS.CellValue)).join(', ').trim();
  }
  if ('text' in value && typeof value.text === 'string') {
    return value.text.trim();
  }
  if ('richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((item) => item.text).join('').trim();
  }
  if ('result' in value) {
    return cellValueToText(value.result as ExcelJS.CellValue);
  }
  if ('formula' in value && typeof value.formula === 'string') {
    return '';
  }
  return String(value).trim();
}

function findLastNonEmptyColumn(row: ExcelJS.Row) {
  let lastColumn = 0;
  row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    if (cellValueToText(cell.value)) lastColumn = Math.max(lastColumn, columnNumber);
  });
  return lastColumn;
}

function findTemplateWorksheet(workbook: ExcelJS.Workbook) {
  return workbook.getWorksheet(TEMPLATE_SHEET_NAME) || workbook.worksheets[0] || null;
}

function findHeaderRow(worksheet: ExcelJS.Worksheet, config: MasterDataImportTargetConfig) {
  const knownHeaders = buildKnownHeaderSet(config);
  const minMatches = Math.min(2, Math.max(1, config.fields.filter((field) => field.required).length));
  const maxRow = Math.min(Math.max(worksheet.rowCount, HEADER_ROW_NUMBER), MAX_HEADER_SCAN_ROWS);

  for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const lastColumn = findLastNonEmptyColumn(row);
    if (lastColumn === 0) continue;
    let matches = 0;
    for (let columnNumber = 1; columnNumber <= lastColumn; columnNumber += 1) {
      const text = cellValueToText(row.getCell(columnNumber).value);
      if (text && knownHeaders.has(normalizeHeader(text))) matches += 1;
    }
    if (matches >= minMatches) return rowNumber;
  }

  return null;
}

export async function buildMasterDataImportTemplateWorkbook(config: MasterDataImportTargetConfig) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PT Gading Mas Surya';
  workbook.created = new Date();
  workbook.modified = new Date();

  const template = workbook.addWorksheet(TEMPLATE_SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: HEADER_ROW_NUMBER }],
  });
  const guide = workbook.addWorksheet(GUIDE_SHEET_NAME);
  const headers = config.fields.map((field) => field.key);
  const rows = config.templateRows.length > 0 ? config.templateRows : [Object.fromEntries(headers.map((header) => [header, '']))];

  template.mergeCells(1, 1, 1, headers.length);
  template.getCell(1, 1).value = `Template Import ${config.label}`;
  template.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FF0F172A' } };
  template.getCell(1, 1).alignment = { vertical: 'middle' };
  template.getRow(1).height = 26;

  template.mergeCells(2, 1, 2, headers.length);
  template.getCell(2, 1).value = config.description;
  template.getCell(2, 1).font = { color: { argb: 'FF475569' } };
  template.getCell(2, 1).alignment = { wrapText: true };

  template.mergeCells(3, 1, 3, headers.length);
  template.getCell(3, 1).value = 'Isi data mulai baris 6. Jangan ubah nama header pada baris 5 agar validasi import tetap cocok.';
  template.getCell(3, 1).font = { italic: true, color: { argb: 'FF64748B' } };
  template.getCell(3, 1).alignment = { wrapText: true };

  config.fields.forEach((field, index) => {
    const column = index + 1;
    const maxExampleLength = Math.max(
      field.key.length,
      field.label.length,
      field.example?.length || 0,
      ...rows.map((row) => (row[field.key] || '').length),
    );
    template.getColumn(column).width = clampWidth(maxExampleLength);
    const headerCell = template.getCell(HEADER_ROW_NUMBER, column);
    headerCell.value = field.key;
    headerCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    headerCell.border = BORDER_STYLE;
    headerCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerCell.note = `${field.label}${field.required ? ' (wajib)' : ' (opsional)'}${field.help ? `\n${field.help}` : ''}`;
  });
  template.getRow(HEADER_ROW_NUMBER).height = 24;

  rows.forEach((row, rowIndex) => {
    const excelRow = template.getRow(HEADER_ROW_NUMBER + 1 + rowIndex);
    config.fields.forEach((field, fieldIndex) => {
      const cell = excelRow.getCell(fieldIndex + 1);
      cell.value = row[field.key] || '';
      applyTableCellStyle(cell, field.required ? REQUIRED_FILL : undefined);
    });
    excelRow.commit();
  });

  template.autoFilter = {
    from: { row: HEADER_ROW_NUMBER, column: 1 },
    to: { row: HEADER_ROW_NUMBER, column: headers.length },
  };

  const guideHeader = guide.getRow(1);
  ['Kolom', 'Label', 'Wajib', 'Contoh', 'Catatan / Alias'].forEach((header, index) => {
    const cell = guideHeader.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = BORDER_STYLE;
  });
  guideHeader.height = 24;

  config.fields.forEach((field, index) => {
    const row = guide.getRow(index + 2);
    const values = [field.key, field.label, field.required ? 'Ya' : 'Tidak', field.example || '', fieldGuideText(field)];
    values.forEach((value, valueIndex) => {
      const cell = row.getCell(valueIndex + 1);
      cell.value = value;
      applyTableCellStyle(cell, field.required ? REQUIRED_FILL : OPTIONAL_FILL);
    });
    row.commit();
  });
  [24, 24, 12, 28, 58].forEach((width, index) => {
    guide.getColumn(index + 1).width = width;
  });
  guide.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 5 },
  };
  guide.views = [{ state: 'frozen', ySplit: 1 }];

  return workbook.xlsx.writeBuffer();
}

export async function parseMasterDataImportXlsx(buffer: ArrayBuffer, config: MasterDataImportTargetConfig): Promise<ParsedMasterDataImportFile> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const worksheet = findTemplateWorksheet(workbook);
  if (!worksheet) {
    throw new Error('Excel tidak memiliki worksheet data');
  }

  const headerRowNumber = findHeaderRow(worksheet, config);
  if (!headerRowNumber) {
    throw new Error('Header Excel tidak ditemukan. Gunakan template Excel dari halaman import.');
  }

  const headerRow = worksheet.getRow(headerRowNumber);
  const lastHeaderColumn = findLastNonEmptyColumn(headerRow);
  const headers: string[] = [];
  for (let columnNumber = 1; columnNumber <= lastHeaderColumn; columnNumber += 1) {
    headers.push(cellValueToText(headerRow.getCell(columnNumber).value));
  }

  if (headers.some((header) => !header)) {
    throw new Error('Header Excel tidak boleh kosong');
  }
  const duplicateHeader = headers.find((header, index) => headers.findIndex((item) => normalizeHeader(item) === normalizeHeader(header)) !== index);
  if (duplicateHeader) {
    throw new Error(`Header Excel duplikat: ${duplicateHeader}`);
  }

  const rows: Record<string, string>[] = [];
  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const excelRow = worksheet.getRow(rowNumber);
    const record: Record<string, string> = {};
    let hasValue = false;
    for (let columnNumber = 1; columnNumber <= lastHeaderColumn; columnNumber += 1) {
      const value = cellValueToText(excelRow.getCell(columnNumber).value);
      if (value) hasValue = true;
      record[headers[columnNumber - 1]] = value;
    }
    for (let columnNumber = lastHeaderColumn + 1; columnNumber <= excelRow.cellCount; columnNumber += 1) {
      if (cellValueToText(excelRow.getCell(columnNumber).value)) {
        throw new Error(`Baris ${rowNumber} memiliki kolom lebih banyak dari header. Hapus kolom ekstra atau pakai template Excel terbaru.`);
      }
    }
    if (hasValue) rows.push(record);
  }

  if (rows.length === 0) {
    throw new Error('Excel harus memiliki header dan minimal satu baris data');
  }

  return { headers, rows };
}

export function isMasterDataImportXlsxFile(file: File) {
  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith('.xlsx') || file.type === MASTER_DATA_IMPORT_XLSX_MIME;
}
