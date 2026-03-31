import { escapePrintHtml } from './print';
import { formatDateTime, formatQuantity, INCIDENT_STATUS_MAP, INCIDENT_TYPE_MAP, URGENCY_MAP } from './utils';
import type { Incident, IncidentActionLog } from './types';

const INCIDENT_NEXT_STATUS_MAP: Record<string, string[]> = {
    OPEN: ['IN_PROGRESS'],
    IN_PROGRESS: ['RESOLVED'],
    RESOLVED: ['CLOSED'],
};

export function sortIncidentActionLogs(logs: IncidentActionLog[]) {
    return [...logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export function getAvailableIncidentStatuses(status: Incident['status']) {
    return INCIDENT_NEXT_STATUS_MAP[status] || [];
}

export function buildIncidentPrintHtml(incident: Incident, logs: IncidentActionLog[]) {
    const incidentNumber = escapePrintHtml(incident.incidentNumber);
    const incidentDateTime = escapePrintHtml(formatDateTime(incident.dateTime));
    const incidentType = escapePrintHtml(INCIDENT_TYPE_MAP[incident.incidentType] || incident.incidentType);
    const incidentStatus = escapePrintHtml(INCIDENT_STATUS_MAP[incident.status]?.label || incident.status);
    const urgency = escapePrintHtml(URGENCY_MAP[incident.urgency]?.label || incident.urgency);
    const vehiclePlate = escapePrintHtml(incident.vehiclePlate || '-');
    const driverName = escapePrintHtml(incident.driverName || '-');
    const odometerLabel = escapePrintHtml(`${incident.odometer ? formatQuantity(incident.odometer, 0) : '-'} km`);
    const locationText = escapePrintHtml(incident.locationText || '-');
    const relatedDONumber = incident.relatedDONumber ? escapePrintHtml(incident.relatedDONumber) : '';
    const description = escapePrintHtml(incident.description || '-');
    const logRows = logs.length > 0
        ? logs.map(item => `
            <tr>
                <td>${escapePrintHtml(formatDateTime(item.timestamp))}</td>
                <td>${escapePrintHtml(item.note || '-')}</td>
                <td>${escapePrintHtml(item.userName || '-')}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="3" class="c">Belum ada log penanganan</td></tr>';

    return `
        <div style="margin-bottom:16px">
            <table style="width:100%;border:none"><tbody>
                <tr>
                    <td style="border:none;padding:2px 8px;width:140px;font-weight:600">No. Insiden</td>
                    <td style="border:none;padding:2px 8px">${incidentNumber}</td>
                    <td style="border:none;padding:2px 8px;width:140px;font-weight:600">Waktu</td>
                    <td style="border:none;padding:2px 8px">${incidentDateTime}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Tipe</td>
                    <td style="border:none;padding:2px 8px">${incidentType}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Status</td>
                    <td style="border:none;padding:2px 8px">${incidentStatus}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Urgensi</td>
                    <td style="border:none;padding:2px 8px">${urgency}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Kendaraan</td>
                    <td style="border:none;padding:2px 8px">${vehiclePlate}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Driver</td>
                    <td style="border:none;padding:2px 8px">${driverName}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Odometer</td>
                    <td style="border:none;padding:2px 8px">${odometerLabel}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Lokasi</td>
                    <td colspan="3" style="border:none;padding:2px 8px">${locationText}</td>
                </tr>
                ${relatedDONumber ? `<tr><td style="border:none;padding:2px 8px;font-weight:600">DO Terkait</td><td colspan="3" style="border:none;padding:2px 8px">${relatedDONumber}</td></tr>` : ''}
            </tbody></table>
        </div>
        <div class="section-title">Kronologi</div>
        <div style="line-height:1.7;color:#334155">${description}</div>
        <div class="section-title">Timeline Penanganan</div>
        <table>
            <thead>
                <tr>
                    <th>Waktu</th>
                    <th>Catatan</th>
                    <th>Petugas</th>
                </tr>
            </thead>
            <tbody>
                ${logRows}
            </tbody>
        </table>
    `;
}
