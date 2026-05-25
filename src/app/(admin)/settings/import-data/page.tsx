'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Download, RefreshCw, Save, XCircle } from 'lucide-react';

import {
  MASTER_DATA_IMPORT_MODES,
  MASTER_DATA_IMPORT_TARGETS,
  type MasterDataImportMode,
  type MasterDataImportTarget,
  type MasterDataImportTargetConfig,
} from '@/lib/master-data-import-config';
import { hasPermission } from '@/lib/rbac';

import { useApp, useToast } from '../../layout';

type ImportAction = 'create' | 'update' | 'skip';
type ImportStatus = 'ready' | 'warning' | 'error' | 'imported';

type ImportRowResult = {
  rowNumber: number;
  status: ImportStatus;
  action: ImportAction;
  keyValue: string;
  displayName: string;
  existingId?: string;
  errors: string[];
  warnings: string[];
  importedId?: string;
};

type ImportResult = {
  target: MasterDataImportTarget;
  mode: MasterDataImportMode;
  summary: {
    totalRows: number;
    ready: number;
    warnings: number;
    errors: number;
    create: number;
    update: number;
    skip: number;
    imported: number;
  };
  rows: ImportRowResult[];
  batchId?: string;
};

const ACTION_LABELS: Record<ImportAction, string> = {
  create: 'Tambah',
  update: 'Update',
  skip: 'Lewati',
};

const STATUS_META: Record<ImportStatus, { label: string; className: string }> = {
  ready: { label: 'Siap', className: 'badge-info' },
  warning: { label: 'Warning', className: 'badge-warning' },
  error: { label: 'Error', className: 'badge-danger' },
  imported: { label: 'Terimport', className: 'badge-success' },
};

function escapeCsvValue(value: unknown) {
  const text = value === undefined || value === null ? '' : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildTemplateCsv(config: MasterDataImportTargetConfig) {
  const headers = config.fields.map((field) => field.key);
  const rows = config.templateRows.length > 0 ? config.templateRows : [Object.fromEntries(headers.map((header) => [header, '']))];
  return [
    headers.map(escapeCsvValue).join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header] || '')).join(',')),
  ].join('\r\n');
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function countDelimiter(line: string, delimiter: ',' | ';' | '\t') {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) count += 1;
  }

  return count;
}

function detectCsvDelimiter(text: string): ',' | ';' | '\t' {
  const firstDataLine = text.split(/\r?\n/).find((line) => line.trim() !== '') || '';
  const candidates: Array<',' | ';' | '\t'> = [',', ';', '\t'];
  const ranked = candidates
    .map((delimiter) => ({ delimiter, count: countDelimiter(firstDataLine, delimiter) }))
    .sort((a, b) => b.count - a.count);
  return ranked[0]?.count > 0 ? ranked[0].delimiter : ',';
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  const delimiter = detectCsvDelimiter(text);
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(current);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  if (inQuotes) {
    throw new Error('Format CSV tidak valid: tanda kutip belum ditutup');
  }
  if (rows.length < 2) {
    throw new Error('CSV harus memiliki header dan minimal satu baris data');
  }

  const headers = rows[0].map((header) => header.trim());
  if (headers.some((header) => !header)) {
    throw new Error('Header CSV tidak boleh kosong');
  }
  const duplicateHeader = headers.find((header, index) => headers.findIndex((item) => item.toLowerCase() === header.toLowerCase()) !== index);
  if (duplicateHeader) {
    throw new Error(`Header CSV duplikat: ${duplicateHeader}`);
  }

  const dataRows = rows.slice(1).map((cells, index) => {
    if (cells.length > headers.length) {
      throw new Error(`Baris ${index + 2} memiliki kolom lebih banyak dari header. Jika nilai berisi koma atau titik koma, bungkus nilai dengan tanda kutip.`);
    }
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] || '').trim();
    });
    return record;
  });

  return { headers, rows: dataRows };
}

function formatMessages(row: ImportRowResult) {
  const messages = [...row.errors, ...row.warnings];
  return messages.length > 0 ? messages.join(' | ') : '-';
}

export default function ImportDataPage() {
  const { user } = useApp();
  const { addToast } = useToast();
  const availableTargets = useMemo(
    () => MASTER_DATA_IMPORT_TARGETS.filter((target) => (
      user &&
      (hasPermission(user.role, target.module, 'create') || hasPermission(user.role, target.module, 'update'))
    )),
    [user],
  );
  const [target, setTarget] = useState<MasterDataImportTarget>(availableTargets[0]?.target || 'customers');
  const [mode, setMode] = useState<MasterDataImportMode>('createOnly');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);

  const selectedConfig = MASTER_DATA_IMPORT_TARGETS.find((item) => item.target === target) || MASTER_DATA_IMPORT_TARGETS[0];
  const selectedMode = MASTER_DATA_IMPORT_MODES.find((item) => item.value === mode) || MASTER_DATA_IMPORT_MODES[0];
  const actionableCount = preview ? preview.summary.create + preview.summary.update : 0;
  const canCommit = Boolean(preview && preview.summary.errors === 0 && actionableCount > 0 && !importing && !loadingPreview);

  useEffect(() => {
    if (availableTargets.length > 0 && !availableTargets.some((item) => item.target === target)) {
      setTarget(availableTargets[0].target);
    }
  }, [availableTargets, target]);

  useEffect(() => {
    setPreview(null);
  }, [target, mode, rows]);

  const resetUploadedFile = () => {
    setFileName('');
    setHeaders([]);
    setRows([]);
  };

  const handleDownloadTemplate = () => {
    downloadTextFile(`template-import-${selectedConfig.target}.csv`, buildTemplateCsv(selectedConfig));
  };

  const handleFileChange = async (file: File | null) => {
    setPreview(null);
    if (!file) {
      resetUploadedFile();
      return;
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      resetUploadedFile();
      addToast('error', 'Saat ini import memakai CSV. Download template lalu simpan sebagai CSV.');
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      setFileName(file.name);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      addToast('success', `${parsed.rows.length} baris dibaca dari CSV`);
    } catch (error) {
      setFileName('');
      setHeaders([]);
      setRows([]);
      addToast('error', error instanceof Error ? error.message : 'Gagal membaca CSV');
    }
  };

  const submitImportRequest = async (action: 'preview' | 'commit') => {
    if (rows.length === 0) {
      addToast('error', 'Upload CSV dulu sebelum validasi');
      return;
    }
    if (action === 'preview') setLoadingPreview(true);
    if (action === 'commit') setImporting(true);
    try {
      const response = await fetch('/api/data-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, target, mode, rows }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Import gagal diproses');
      const result = payload.data as ImportResult;
      setPreview(result);
      if (action === 'preview') {
        addToast(result.summary.errors > 0 ? 'warning' : 'success', result.summary.errors > 0 ? 'Preview selesai, masih ada error' : 'Preview valid');
      } else {
        addToast(result.summary.errors > 0 ? 'warning' : 'success', result.summary.errors > 0 ? 'Import sebagian gagal. Cek baris error.' : 'Import selesai');
      }
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Import gagal diproses');
    } finally {
      setLoadingPreview(false);
      setImporting(false);
    }
  };

  if (availableTargets.length === 0) {
    return (
      <div className="empty-state">
        <AlertTriangle size={48} className="empty-state-icon" />
        <div className="empty-state-title">Tidak ada akses import</div>
        <div className="empty-state-text">Akses import mengikuti hak tambah atau update pada modul Customer, Supplier, dan Barang Gudang.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Import Data</h1>
          <div className="page-subtitle">Import master data memakai staging preview sebelum masuk database.</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={handleDownloadTemplate}>
            <Download size={16} /> Template CSV
          </button>
        </div>
      </div>

      <div className="info-banner" style={{ marginBottom: '1rem' }}>
        <div className="info-banner-title">Batas aman import</div>
        <div className="info-banner-text">
          Fitur ini hanya untuk master Customer, Supplier, dan Barang Gudang. Stok barang tidak diubah dari import master; stok tetap lewat pembelian atau mutasi stok agar laporan tidak mismatch.
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Baris CSV</div><div className="kpi-value">{rows.length}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Siap Tambah</div><div className="kpi-value">{preview?.summary.create || 0}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Siap Update</div><div className="kpi-value">{preview?.summary.update || 0}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Error</div><div className="kpi-value">{preview?.summary.errors || 0}</div></div></div>
      </div>

      <div className="table-container" style={{ marginBottom: '1rem' }}>
        <div className="table-toolbar">
          <div className="table-toolbar-left">
            <div>
              <div className="font-semibold">Pengaturan Import</div>
              <div className="text-muted text-sm">{selectedConfig.description}</div>
            </div>
          </div>
          <div className="table-toolbar-right">
            <button className="btn btn-secondary" onClick={() => void submitImportRequest('preview')} disabled={loadingPreview || importing || rows.length === 0}>
              <RefreshCw size={16} /> {loadingPreview ? 'Validasi...' : 'Preview'}
            </button>
            <button className="btn btn-primary" onClick={() => void submitImportRequest('commit')} disabled={!canCommit}>
              <Save size={16} /> {importing ? 'Mengimport...' : 'Commit Import'}
            </button>
          </div>
        </div>

        <div className="form-row" style={{ padding: '1rem 1rem 0' }}>
          <div className="form-group">
            <label className="form-label">Target Data</label>
            <select className="form-select" value={target} onChange={(event) => setTarget(event.target.value as MasterDataImportTarget)}>
              {availableTargets.map((item) => <option key={item.target} value={item.target}>{item.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Mode Import</label>
            <select className="form-select" value={mode} onChange={(event) => setMode(event.target.value as MasterDataImportMode)}>
              {MASTER_DATA_IMPORT_MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>{selectedMode.description}</div>
          </div>
        </div>

        <div className="form-row" style={{ padding: '0 1rem 1rem' }}>
          <div className="form-group">
            <label className="form-label">Upload CSV</label>
            <input className="form-input" type="file" accept=".csv,text/csv" onChange={(event) => void handleFileChange(event.target.files?.[0] || null)} />
            <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>{fileName || 'Belum ada file dipilih'}</div>
          </div>
          <div className="form-group">
            <label className="form-label">Kolom terbaca</label>
            <input className="form-input" value={headers.length > 0 ? headers.join(', ') : '-'} readOnly />
          </div>
        </div>
      </div>

      <div className="table-container" style={{ marginBottom: '1rem' }}>
        <div className="table-toolbar">
          <div className="table-toolbar-left">
            <div>
              <div className="font-semibold">Format Template {selectedConfig.label}</div>
              <div className="text-muted text-sm">Kolom wajib: {selectedConfig.fields.filter((field) => field.required).map((field) => field.label).join(', ')}</div>
            </div>
          </div>
        </div>
        <div className="table-wrapper table-desktop-only">
          <table>
            <thead><tr><th>Kolom</th><th>Wajib</th><th>Contoh</th><th>Catatan</th></tr></thead>
            <tbody>
              {selectedConfig.fields.map((field) => (
                <tr key={field.key}>
                  <td><span className="font-mono">{field.key}</span><div className="text-muted text-xs">{field.label}</div></td>
                  <td>{field.required ? <span className="badge badge-warning">Wajib</span> : <span className="badge badge-gray">Opsional</span>}</td>
                  <td>{field.example || '-'}</td>
                  <td>{field.help || (field.aliases?.length ? `Alias: ${field.aliases.slice(0, 4).join(', ')}` : '-')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {preview && (
        <div className="table-container">
          <div className="table-toolbar">
            <div className="table-toolbar-left">
              <div>
                <div className="font-semibold">Preview Import</div>
                <div className="text-muted text-sm">
                  {preview.summary.totalRows} baris, {preview.summary.create} tambah, {preview.summary.update} update, {preview.summary.skip} lewati.
                  {preview.batchId ? ` Batch: ${preview.batchId}` : ''}
                </div>
              </div>
            </div>
            <div className="table-toolbar-right">
              {preview.summary.errors > 0 ? (
                <span className="badge badge-danger"><XCircle size={14} /> Perbaiki error dulu</span>
              ) : (
                <span className="badge badge-success"><CheckCircle size={14} /> Valid</span>
              )}
            </div>
          </div>
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Baris</th><th>Data</th><th>Aksi</th><th>Status</th><th>Pesan Validasi</th></tr></thead>
              <tbody>
                {preview.rows.map((row) => {
                  const meta = STATUS_META[row.status] || STATUS_META.warning;
                  return (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td><div className="font-semibold">{row.displayName}</div><div className="text-muted text-xs font-mono">{row.keyValue || '-'}</div></td>
                      <td>{ACTION_LABELS[row.action]}</td>
                      <td><span className={`badge ${meta.className}`}>{meta.label}</span></td>
                      <td>{formatMessages(row)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
