import fs from 'node:fs';
import path from 'node:path';

const appDir = process.cwd();
const businessDatePath = path.join(appDir, 'src/lib/business-date.ts');
const utilsPath = path.join(appDir, 'src/lib/utils.ts');
const driverIncidentRoutePath = path.join(appDir, 'src/app/api/driver/incidents/route.ts');
const operationsWorkflowPath = path.join(appDir, 'src/lib/api/operations-workflows.ts');
const trackingHomePath = path.join(
    appDir,
    'apps/driver_app/lib/src/features/tracking/presentation/tracking_home_page.dart'
);
const completionPath = path.join(
    appDir,
    'apps/driver_app/lib/src/features/tracking/presentation/delivery_completion_page.dart'
);

const sources = {
    businessDate: fs.readFileSync(businessDatePath, 'utf8'),
    utils: fs.readFileSync(utilsPath, 'utf8'),
    driverIncidentRoute: fs.readFileSync(driverIncidentRoutePath, 'utf8'),
    operationsWorkflow: fs.readFileSync(operationsWorkflowPath, 'utf8'),
    trackingHome: fs.readFileSync(trackingHomePath, 'utf8'),
    completion: fs.readFileSync(completionPath, 'utf8'),
};

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertIncludes(source, expected, message) {
    assert(source.includes(expected), message);
}

function assertNotIncludes(source, forbidden, message) {
    assert(!source.includes(forbidden), message);
}

assertIncludes(
    sources.businessDate,
    "export const BUSINESS_TIME_ZONE = 'Asia/Jakarta'",
    'Business date backend harus eksplisit memakai Asia/Jakarta.'
);
assertIncludes(
    sources.businessDate,
    'Intl.DateTimeFormat',
    'Business date backend harus memakai formatter timezone-aware, bukan tanggal UTC mentah.'
);
assertIncludes(
    sources.utils,
    "const JAKARTA_TIME_ZONE = 'Asia/Jakarta'",
    'Format tanggal admin harus memakai timezone Jakarta.'
);
assertIncludes(
    sources.driverIncidentRoute,
    'getBusinessDateValue()',
    'Tanggal biaya incident dari driver harus memakai business date Jakarta.'
);
assertIncludes(
    sources.operationsWorkflow,
    'getBusinessDateTimeLocalValue()',
    'Waktu incident default backend harus memakai local business datetime Jakarta.'
);
assertIncludes(
    sources.operationsWorkflow,
    'getBusinessCalendarDateParts(incidentDateTime)',
    'Nomor incident harus diperiodekan dari tanggal bisnis, bukan UTC mentah.'
);
assertIncludes(
    sources.trackingHome,
    'const _jakartaUtcOffset = Duration(hours: 7);',
    'Mobile tracking harus menampilkan waktu dalam WIB.'
);
assertIncludes(
    sources.trackingHome,
    'return value.toUtc().add(_jakartaUtcOffset);',
    'Mobile tracking harus mengonversi timestamp API ke Jakarta sebelum tampil.'
);
assertIncludes(
    sources.trackingHome,
    "return '${twoDigits(jakarta.hour)}:${twoDigits(jakarta.minute)} WIB';",
    'Mobile tracking harus memberi label waktu WIB.'
);
assertIncludes(
    sources.completion,
    'DateTime.now().toUtc().add(const Duration(hours: 7))',
    'Tanggal POD mobile harus default ke tanggal Jakarta.'
);
assertIncludes(
    sources.completion,
    'String _currentJakartaDateValue()',
    'Tanggal POD mobile harus memakai helper tanggal Jakarta.'
);
assertNotIncludes(
    sources.businessDate,
    'toISOString().slice(0, 10)',
    'Business date backend tidak boleh memakai tanggal UTC slice karena bisa bergeser di WIB.'
);
assertNotIncludes(
    sources.operationsWorkflow,
    'new Date().toISOString().slice(0, 10)',
    'Workflow incident tidak boleh membuat tanggal default dari UTC slice.'
);

console.log('Mobile timezone audit OK: backend business date, incident dates, and mobile display/default dates use Asia/Jakarta/WIB.');
