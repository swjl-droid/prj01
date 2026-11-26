// Builds the 8 mock schedules, the blank templates and the refused-file samples for prj01-R1 US-2
// (schedule import; decision Hub row 239). Synthetic data only.
// Mock 1 of each method = the "before" baseline of Master_RAIDD_Governance_and_Schedule_Suite-v4.xlsx
// (CRM & Digital Checkout), made complete with the per-method changes John approved; mock 2 = a larger
// project with the edge cases (milestones, several predecessors, SS/FF links, lags incl. negative,
// two levels of hierarchy, empty optional fields, dd/mm/yyyy dates).
// Usage: node scripts/make-mock-schedules.mjs   (writes samples/schedules, samples/templates)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import profiles from '../lib/schedule/profiles.json' with { type: 'json' };

const out = path.resolve(import.meta.dirname, '..', 'samples');
const header = (method) => {
  const p = profiles.methods[method];
  return [...profiles.slots.map((s) => p.labels[s]), ...p.extras.map((x) => x.label)];
};
const csvCell = (v) => (/[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

async function toXlsx(rows, sheet, file, dateCols = []) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  rows.forEach((r, i) => {
    const vals = r.map((v, c) => (i > 0 && dateCols.includes(c) && /^\d{4}-\d{2}-\d{2}$/.test(v)
      ? new Date(`${v}T00:00:00Z`) : v));
    const row = ws.addRow(vals);
    if (i === 0) row.font = { bold: true };
    dateCols.forEach((c) => { row.getCell(c + 1).numFmt = 'yyyy-mm-dd'; });
  });
  ws.columns.forEach((col) => { col.width = 22; });
  await wb.xlsx.writeFile(file);
}

// Columns: Key, Name, Type, Parent, Start, Finish, Duration, Size, Owner, Status, Links, Notes, extras...
const S = {};

S['PMI-PMBOK-1'] = [
  ['T1', 'Initiation & Design', 'Summary', '', '2026-10-01', '2026-10-07', '5d', '', 'Programme Manager', 'Not started', '', 'Summary of WBS 1.'],
  ['T1.1', 'Requirements & Architecture Sign-off', 'Task', 'T1', '2026-10-01', '2026-10-07', '5d', '', 'Solution Architect', 'Not started', '', 'Baseline WBS; assumes corporate SSO works out of the box.'],
  ['T2', 'Front-End Build', 'Summary', '', '2026-10-08', '2026-10-19', '8d', '', 'Delivery Lead', 'Not started', '', 'Summary of WBS 2.'],
  ['T2.0', 'Build Mobile Login & Checkout UI', 'Task', 'T2', '2026-10-08', '2026-10-19', '8d', '', 'Front-End Lead', 'Not started', 'T1.1', 'Starts without SSO verification.'],
  ['T3', 'Data Migration', 'Summary', '', '2026-10-12', '2026-10-19', '6d', '', 'Data Lead', 'Not started', '', 'Summary of WBS 3.'],
  ['T3.1', 'Build Legacy CRM Data Migration Scripts', 'Task', 'T3', '2026-10-12', '2026-10-19', '6d', '', 'Data Lead', 'Not started', 'T1.1', 'No schema audit scheduled before scripting.'],
  ['T4', 'Integration & Test', 'Summary', '', '2026-10-20', '2026-11-03', '11d', '', 'QA Lead', 'Not started', '', 'Summary of WBS 4.'],
  ['T4.1', 'Integrate Payment Gateway API', 'Task', 'T4', '2026-10-20', '2026-10-26', '5d', '', 'Payments Engineer', 'Not started', 'T2.0', 'Assumes vendor API keys are ready on 20 Oct.'],
  ['T4.2', 'Execute QA System & Regression Testing', 'Task', 'T4', '2026-10-27', '2026-11-03', '6d', '', 'QA Lead', 'Not started', 'T3.1, T4.1', 'Blocked if the staging sandbox licence expires.'],
  ['T4.5', 'Build Custom Phase 2 Analytics Reports', 'Task', 'T4', '2026-10-27', '2026-11-02', '5d', '', 'Analytics Lead', 'Not started', 'T3.1', 'Competes for senior developer capacity before go-live.'],
  ['M05', 'Q4 Production Go-Live', 'Milestone', '', '2026-11-06', '2026-11-06', '0d', '', 'Programme Sponsor', 'Not started', 'T4.2, T4.5', 'Unbuffered launch date.'],
];

S['PMI-PMBOK-2'] = [
  ['1', 'Clinic Relocation', 'Summary', '', '02/11/2026', '26/03/2027', '', '', 'Programme Manager', 'In progress', '', 'Synthetic sample project.'],
  ['1.1', 'Planning', 'Summary', '1', '02/11/2026', '27/11/2026', '20d', '', 'Programme Manager', 'In progress', '', ''],
  ['1.1.1', 'Site survey of the new building', 'Task', '1.1', '02/11/2026', '06/11/2026', '5d', '', 'Facilities Manager', 'Done', '', ''],
  ['1.1.2', 'Floor plan and room allocation', 'Task', '1.1', '09/11/2026', '20/11/2026', '10d', '', 'Clinical Operations Lead', 'In progress', '1.1.1', 'Needs sign-off by each department head.'],
  ['1.1.3', 'Patient communication plan', 'Task', '1.1', '16/11/2026', '27/11/2026', '10d', '', '', 'Not started', '1.1.2SS+5d', 'Starts 5 days after floor planning starts.'],
  ['M1', 'Planning approved', 'Milestone', '1', '27/11/2026', '27/11/2026', '0d', '', 'Clinic Director', 'Not started', '1.1.2, 1.1.3', ''],
  ['1.2', 'Fit-out', 'Summary', '1', '30/11/2026', '19/02/2027', '60d', '', 'Facilities Manager', 'Not started', '', ''],
  ['1.2.1', 'Electrical and data cabling', 'Task', '1.2', '30/11/2026', '18/12/2026', '15d', '', 'Facilities Manager', 'Not started', 'M1', ''],
  ['1.2.2', 'Medical gas and plumbing', 'Task', '1.2', '07/12/2026', '08/01/2027', '20d', '', 'Facilities Manager', 'Not started', '1.2.1SS+5d', 'Overlaps the cabling work.'],
  ['1.2.3', 'Install imaging equipment', 'Task', '1.2', '11/01/2027', '29/01/2027', '15d', '', 'Biomedical Engineer', 'Not started', '1.2.1, 1.2.2', 'Vendor install window fixed.'],
  ['1.2.4', 'IT systems and patient records link', 'Task', '1.2', '04/01/2027', '29/01/2027', '20d', '', 'IT Manager', 'Not started', '1.2.1+10d', ''],
  ['1.2.5', 'Regulatory inspection', 'Task', '1.2', '01/02/2027', '12/02/2027', '10d', '', 'Compliance Officer', 'Not started', '1.2.3, 1.2.4', ''],
  ['B1', 'Fit-out schedule reserve', 'Buffer', '1.2', '15/02/2027', '19/02/2027', '5d', '5', 'Programme Manager', 'Not started', '1.2.5', 'Contingency before the move.'],
  ['1.3', 'Move and go-live', 'Summary', '1', '22/02/2027', '26/03/2027', '25d', '', 'Clinic Director', 'Not started', '', ''],
  ['1.3.1', 'Staff training in the new building', 'Task', '1.3', '22/02/2027', '05/03/2027', '10d', '', 'Clinical Operations Lead', 'Not started', 'B1', ''],
  ['1.3.2', 'Move equipment and records', 'Task', '1.3', '06/03/2027', '14/03/2027', '6d', '', 'Facilities Manager', 'Not started', '1.3.1FF+2d', 'Finishes 2 days after training finishes.'],
  ['1.3.3', 'Reduced clinic schedule during the move', 'Task', '1.3', '05/03/2027', '16/03/2027', '8d', '', 'Clinic Director', 'Not started', '1.3.2SS-1d', 'Starts 1 day before the move starts.'],
  ['M2', 'First patient seen in the new clinic', 'Milestone', '1.3', '17/03/2027', '17/03/2027', '0d', '', 'Clinic Director', 'Not started', '1.3.2, 1.3.3', ''],
  ['1.3.4', 'Hand back the old building', 'Task', '1.3', '17/03/2027', '26/03/2027', '8d', '', 'Facilities Manager', 'Not started', 'M2', ''],
];

// PRINCE2 extra: Product.
S['PRINCE2-1'] = [
  ['STG-1', 'Stage 1: Initiation & Technical Design', 'Stage', '', '2026-10-01', '2026-10-07', '5d', '0', 'Project Manager', 'Not started', '', 'Project Initiation Documentation (PID) baseline.', 'Project Initiation Documentation'],
  ['WP-01', 'Initiation & technical design', 'Work Package', 'STG-1', '2026-10-01', '2026-10-07', '5d', '0', 'Architecture Team Manager', 'Not started', '', '', 'Solution design'],
  ['STG-2', 'Stage 2: Build & Verification', 'Stage', '', '2026-10-08', '2026-11-02', '19d', '2', 'Project Manager', 'Not started', 'STG-1', '', 'Release candidate'],
  ['WP-02', 'Core checkout & SSO build', 'Work Package', 'STG-2', '2026-10-08', '2026-10-19', '8d', '2', 'Checkout Team Manager', 'Not started', 'WP-01', 'Assumes corporate SSO needs no change.', 'Checkout and login'],
  ['WP-03', 'Legacy CRM data migration', 'Work Package', 'STG-2', '2026-10-12', '2026-10-19', '6d', '2', 'Data Team Manager', 'Not started', 'WP-01', 'No diagnostic data audit in the Stage 2 plan.', 'Migrated customer records'],
  ['WP-04', 'Payment API & QA verification', 'Work Package', 'STG-2', '2026-10-20', '2026-11-02', '10d', '2', 'QA Team Manager', 'Not started', 'WP-02, WP-03', 'Includes custom analytics reporting scope.', 'Verified payment flow'],
  ['STG-3', 'Stage 3: Go-Live', 'Stage', '', '2026-11-06', '2026-11-06', '0d', '0', 'Project Manager', 'Not started', 'STG-2', '', 'Live service'],
  ['SB-02', 'End stage boundary & go-live approval', 'Stage Gate', 'STG-3', '2026-11-06', '2026-11-06', '0d', '0', 'Project Board', 'Not started', 'WP-04', 'Project Board sign-off required for Stage 3.', 'End Stage Report'],
];

S['PRINCE2-2'] = [
  ['STG-1', 'Initiation', 'Stage', '', '2026-10-05', '2026-10-16', '10d', '1', 'Project Manager', 'Done', '', '', 'Project Initiation Documentation'],
  ['WP-11', 'Business case and project brief', 'Work Package', 'STG-1', '2026-10-05', '2026-10-09', '5d', '', 'Project Manager', 'Done', '', '', 'Business Case'],
  ['WP-12', 'Site requirements', 'Work Package', 'STG-1', '2026-10-12', '2026-10-16', '5d', '1', 'Workplace Team Manager', 'Done', 'WP-11', '', 'Requirements Specification'],
  ['SB-1', 'End of initiation', 'Stage Gate', 'STG-1', '2026-10-16', '2026-10-16', '0d', '', 'Project Board', 'Done', 'WP-12', '', 'End Stage Report'],
  ['STG-2', 'Design', 'Stage', '', '2026-10-19', '2026-11-20', '25d', '3', 'Project Manager', 'In progress', 'STG-1', '', 'Approved design'],
  ['WP-21', 'Space design for 2 floors', 'Work Package', 'STG-2', '2026-10-19', '2026-11-06', '15d', '3', 'Design Team Manager', 'In progress', 'SB-1', 'Two design reviews planned.', 'Floor layouts'],
  ['WP-22', 'Contractor tender', 'Work Package', 'STG-2', '2026-10-26', '2026-11-20', '20d', '3', 'Procurement Team Manager', 'In progress', 'WP-21SS+5d', 'Tender opens once the first layout is drafted.', 'Signed contract'],
  ['EXT-21', 'Landlord approval of works', 'External Gate', 'STG-2', '2026-11-13', '2026-11-13', '0d', '2', 'Landlord', 'Not started', 'WP-21', 'Outside the project team.', ''],
  ['SB-2', 'End of design', 'Stage Gate', 'STG-2', '2026-11-20', '2026-11-20', '0d', '', 'Project Board', 'Not started', 'WP-22, EXT-21', '', 'End Stage Report'],
  ['STG-3', 'Build and move-in', 'Stage', '', '2026-11-23', '2027-02-19', '65d', '5', 'Project Manager', 'Not started', 'STG-2', '', 'Occupied office'],
  ['WP-31', 'Construction and fit-out', 'Work Package', 'STG-3', '2026-11-23', '2027-01-29', '50d', '5', 'Contractor Team Manager', 'Not started', 'SB-2', '', 'Fitted floors'],
  ['WP-32', 'IT and network install', 'Work Package', 'STG-3', '2027-01-11', '2027-02-05', '20d', '3', 'IT Team Manager', 'Not started', 'WP-31FF+5d', 'Finishes 5 days after construction finishes.', 'Working network'],
  ['ISS-31', 'Escalate late furniture delivery', 'Issue Action', 'STG-3', '2027-01-18', '2027-01-19', '2d', '', 'Project Manager', 'Not started', '', 'Within stage tolerance; no exception plan.', ''],
  ['WP-33', 'Move-in and handover', 'Work Package', 'STG-3', '2027-02-08', '2027-02-19', '10d', '2', 'Workplace Team Manager', 'Not started', 'WP-32, ISS-31', '', 'Handover certificate'],
  ['SB-3', 'Project closure', 'Stage Gate', 'STG-3', '2027-02-19', '2027-02-19', '0d', '', 'Project Board', 'Not started', 'WP-33', '', 'End Project Report'],
];

// Agile extras: Lane, Release Cut-Line. Duration slot = Sprint name.
S['Agile-1'] = [
  ['EP-1', 'Mobile checkout', 'Epic', '', '2026-10-01', '2026-10-28', 'Sprint 1-2', '', 'Product Owner', 'To do', '', '', 'Backlog', 'Above'],
  ['EP-2', 'Customer data and reporting', 'Epic', '', '2026-10-15', '2026-10-28', 'Sprint 2', '', 'Product Owner', 'To do', '', '', 'Backlog', 'Above'],
  ['US-101', 'Mobile checkout login screen (SSO)', 'User Story', 'EP-1', '2026-10-01', '2026-10-14', 'Sprint 1', '5', 'Checkout Squad', 'To do', '', 'Assumes SSO works; risk of mid-sprint failure.', 'Sprint board', 'Above'],
  ['US-102', 'Import legacy CRM customer records', 'User Story', 'EP-2', '2026-10-15', '2026-10-28', 'Sprint 2', '8', 'Data Squad', 'To do', '', 'No audit done; risk of spillover into Sprint 3.', 'Sprint board', 'Above'],
  ['US-103', 'Wire up FinTech payment gateway', 'User Story', 'EP-1', '2026-10-15', '2026-10-28', 'Sprint 2', '5', 'Payments Squad', 'To do', 'US-101', 'Needs vendor API keys by 18 Oct.', 'Sprint board', 'Above'],
  ['US-104', 'Execute QA regression suite', 'User Story', 'EP-1', '2026-10-15', '2026-10-28', 'Sprint 2', '5', 'QA Squad', 'To do', 'US-102, US-103', 'Needs the staging environment.', 'Sprint board', 'Above'],
  ['US-105', 'Build custom Phase 2 analytics dashboard', 'User Story', 'EP-2', '2026-10-15', '2026-10-28', 'Sprint 2', '8', 'Analytics Squad', 'To do', 'US-102', 'Overloads Sprint 2 capacity.', 'Sprint board', 'Above'],
];

S['Agile-2'] = [
  ['EP-10', 'Sign-in and account', 'Epic', '', '2026-11-16', '2026-12-11', 'Sprint 1-2', '', 'Product Owner', 'In progress', '', '', 'Backlog', 'Above'],
  ['EP-20', 'Bills and payments', 'Epic', '', '2026-11-30', '2026-12-25', 'Sprint 2-3', '', 'Product Owner', 'To do', '', '', 'Backlog', 'Above'],
  ['EP-30', 'Service requests', 'Epic', '', '2026-12-14', '2026-12-25', 'Sprint 3', '', 'Product Owner', 'To do', '', '', 'Backlog', 'Below'],
  ['SPK-11', 'Spike: choose the identity provider', 'Spike', 'EP-10', '2026-11-16', '2026-11-27', 'Sprint 1', '2', 'Tech Lead', 'Done', '', 'Timeboxed to 2 days.', 'Sprint board', 'Above'],
  ['US-12', 'Sign up with e-mail', 'User Story', 'EP-10', '2026-11-16', '2026-11-27', 'Sprint 1', '5', 'Team A', 'In progress', 'SPK-11', '', 'Sprint board', 'Above'],
  ['US-13', 'Reset a forgotten password', 'User Story', 'EP-10', '2026-11-30', '2026-12-11', 'Sprint 2', '3', 'Team A', 'To do', 'US-12', '', 'Sprint board', 'Above'],
  ['EN-14', 'Enabler: audit log for sign-ins', 'Enabler', 'EP-10', '2026-11-30', '2026-12-11', 'Sprint 2', '3', 'Team B', 'To do', 'US-12', '', 'Sprint board', 'Above'],
  ['DEP-21', 'Billing system API ready (external)', 'Dependency', 'EP-20', '2026-12-04', '2026-12-04', 'Sprint 2', '0', 'Vendor Manager', 'To do', '', 'Outside the team; checked weekly.', 'Dependencies', 'Above'],
  ['US-22', 'View my last 12 bills', 'User Story', 'EP-20', '2026-11-30', '2026-12-11', 'Sprint 2', '8', 'Team B', 'To do', 'DEP-21+3d, US-12', 'Starts 3 days after the billing API is ready.', 'Sprint board', 'Above'],
  ['US-23', 'Pay a bill by card', 'User Story', 'EP-20', '2026-12-14', '2026-12-25', 'Sprint 3', '8', 'Team B', 'To do', 'US-22', '', 'Sprint board', 'Above'],
  ['BLK-24', 'Blocker: renew payment sandbox licence', 'Blocker', 'EP-20', '2026-12-01', '2026-12-01', 'Sprint 2', '1', 'IT Operations', 'To do', '', 'Expedite lane; bypasses the WIP limit.', 'Expedite', 'Above'],
  ['BUG-25', 'Bill PDF shows the wrong month', 'Bug', 'EP-20', '2026-12-14', '2026-12-25', 'Sprint 3', '2', 'Team B', 'To do', 'US-22', '', 'Sprint board', 'Above'],
  ['US-31', 'Raise a service request', 'User Story', 'EP-30', '2026-12-14', '2026-12-25', 'Sprint 3', '5', 'Team A', 'To do', 'US-12', '', 'Backlog', 'Below'],
  ['US-32', 'Track a service request', 'User Story', 'EP-30', '2026-12-14', '2026-12-25', 'Sprint 3', '3', '', 'To do', 'US-31', '', 'Backlog', 'Below'],
];

S['Hybrid-1'] = [
  ['GATE-1', 'Macro gate 1: architecture & scope freeze', 'Macro Waterfall', '', '2026-10-07', '2026-10-07', 'Phase Gate 1', '', 'PM & Sponsor', 'Not started', '', 'Executive milestone baseline.'],
  ['GATE-2', 'Macro gate 2: UAT entry', 'Macro Waterfall', '', '2026-10-28', '2026-10-28', 'Phase Gate 2', '', 'Programme Sponsor', 'Not started', 'SQ-01, SQ-02', 'Referred to in v4 but missing there; added.'],
  ['SQ-01', 'Squad sprint 1: mobile SSO & checkout UI', 'Micro Agile', 'GATE-2', '2026-10-01', '2026-10-14', 'Sprint 1', '', 'Checkout Squad', 'Not started', 'GATE-1', 'Squad builds against an unverified SSO assumption.'],
  ['SQ-02', 'Squad sprint 2: CRM migration & payments', 'Micro Agile', 'GATE-2', '2026-10-15', '2026-10-28', 'Sprint 2', '', 'Data & Pay Squads', 'Not started', 'SQ-01', 'No buffer between vendor keys and the UAT gate.'],
  ['SQ-03', 'Squad sprint 2: custom analytics reports', 'Micro Agile', 'GATE-3', '2026-10-15', '2026-10-28', 'Sprint 2', '', 'Analytics Squad', 'Not started', 'SQ-01', 'Competes for developer capacity before UAT.'],
  ['GATE-3', 'Macro gate 3: Q4 production go-live', 'Macro Waterfall', '', '2026-11-06', '2026-11-06', 'Phase Gate 3', '', 'Programme Sponsor', 'Not started', 'GATE-2, SQ-03', 'Hard executive launch date.'],
];

S['Hybrid-2'] = [
  ['G0', 'Gate 0: programme mandate', 'Macro Waterfall', '', '2026-11-02', '2026-11-02', 'Gate 0', '', 'Sponsor', 'Done', '', 'Branch network refresh, synthetic.'],
  ['G1', 'Gate 1: design approved', 'Macro Waterfall', '', '2026-11-27', '2026-11-27', 'Gate 1', '', 'Steering Committee', 'In progress', 'SQ-A1, SQ-B1', ''],
  ['SQ-A1', 'Squad A sprint 1: branch booking app prototype', 'Micro Agile', 'G1', '2026-11-03', '2026-11-16', 'Sprint 1', '13', 'Squad A', 'Done', 'G0', ''],
  ['SQ-B1', 'Squad B sprint 1: network survey tooling', 'Micro Agile', 'G1', '2026-11-03', '2026-11-16', 'Sprint 1', '8', 'Squad B', 'Done', 'G0', ''],
  ['EXT-V1', 'Vendor: router hardware delivered', 'Macro Waterfall', 'G2', '2026-12-11', '2026-12-11', 'Vendor Gate', '', 'Vendor Manager', 'Not started', 'G1', 'External milestone on the executive Gantt.'],
  ['SQ-A2', 'Squad A sprint 2: booking app pilot release', 'Micro Agile', 'G2', '2026-11-30', '2026-12-11', 'Sprint 2', '13', 'Squad A', 'Not started', 'G1', ''],
  ['SQ-A3', 'Squad A sprint 3: booking app feedback fixes', 'Micro Agile', 'G2', '2026-12-14', '2026-12-25', 'Sprint 3', '8', 'Squad A', 'Not started', 'SQ-A2', ''],
  ['SQ-B2', 'Squad B sprint 2: pilot branch cut-over', 'Micro Agile', 'G2', '2026-12-14', '2026-12-25', 'Sprint 3', '13', 'Squad B', 'Not started', 'EXT-V1+3d', 'Starts 3 days after the routers arrive.'],
  ['BLK-B1', 'Squad blocker: firewall change approval', 'Micro Agile', 'G2', '2026-12-08', '2026-12-08', 'Kanban Expedite', '1', 'IT Operations', 'Not started', '', 'Handled in daily stand-up; gate unchanged.'],
  ['G2', 'Gate 2: pilot complete', 'Macro Waterfall', '', '2026-12-31', '2026-12-31', 'Gate 2', '', 'Steering Committee', 'Not started', 'SQ-A3, SQ-B2, BLK-B1', ''],
  ['G3', 'Gate 3: national roll-out approved', 'Macro Waterfall', '', '2027-01-15', '2027-01-15', 'Gate 3', '', 'Sponsor', 'Not started', 'G2', ''],
];

const plan = [
  ['PMI-PMBOK-1', 'PMI-PMBOK', 'pmi-1-crm-digital-checkout.xlsx', 'xlsx'],
  ['PMI-PMBOK-2', 'PMI-PMBOK', 'pmi-2-clinic-relocation.csv', 'csv'],
  ['PRINCE2-1', 'PRINCE2', 'prince2-1-crm-digital-checkout.csv', 'csv'],
  ['PRINCE2-2', 'PRINCE2', 'prince2-2-regional-office-fit-out.xlsx', 'xlsx'],
  ['Agile-1', 'Agile', 'agile-1-crm-digital-checkout.xlsx', 'xlsx'],
  ['Agile-2', 'Agile', 'agile-2-customer-portal.csv', 'csv'],
  ['Hybrid-1', 'Hybrid', 'hybrid-1-crm-digital-checkout.csv', 'csv'],
  ['Hybrid-2', 'Hybrid', 'hybrid-2-branch-network-refresh.xlsx', 'xlsx'],
];

mkdirSync(path.join(out, 'schedules', 'bad'), { recursive: true });
mkdirSync(path.join(out, 'templates'), { recursive: true });
const manifest = [];
for (const [id, method, file, kind] of plan) {
  const rows = [header(method), ...S[id]];
  const f = path.join(out, 'schedules', file);
  if (kind === 'csv') writeFileSync(f, toCsv(rows));
  else await toXlsx(rows, id, f, [4, 5]);
  manifest.push({ file, method, items: S[id].length, links: S[id].reduce((n, r) => n + (r[10] ? r[10].split(',').length : 0), 0) });
}
writeFileSync(path.join(out, 'schedules', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

for (const method of Object.keys(profiles.methods)) {
  const slug = method.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  writeFileSync(path.join(out, 'templates', `${slug}-template.csv`), toCsv([header(method)]));
  await toXlsx([header(method)], method, path.join(out, 'templates', `${slug}-template.xlsx`));
}

// Files that must be refused, each with the reason the import must give.
const pmiHead = header('PMI-PMBOK');
const bad = {
  'missing-column.csv': [pmiHead.filter((h) => h !== 'Finish Date'), ['T1', 'Design', 'Task', '', '2026-10-01', '5d', '', '', '', '', '']],
  'unknown-column.csv': [[...pmiHead, 'Budget'], ['T1', 'Design', 'Task', '', '2026-10-01', '2026-10-07', '5d', '', '', '', '', '', '1000']],
  'bad-date.csv': [pmiHead, ['T1', 'Design', 'Task', '', '2026-10-01', '31/02/2026', '5d', '', '', '', '', '']],
  'finish-before-start.csv': [pmiHead, ['T1', 'Design', 'Task', '', '2026-10-07', '2026-10-01', '5d', '', '', '', '', '']],
  'unknown-link.csv': [pmiHead, ['T1', 'Design', 'Task', '', '2026-10-01', '2026-10-07', '5d', '', '', '', 'T9', '']],
  'duplicate-key.csv': [pmiHead, ['T1', 'Design', 'Task', '', '2026-10-01', '2026-10-07', '5d', '', '', '', '', ''], ['T1', 'Build', 'Task', '', '2026-10-08', '2026-10-19', '8d', '', '', '', '', '']],
  'unknown-type.csv': [pmiHead, ['T1', 'Design', 'Epic', '', '2026-10-01', '2026-10-07', '5d', '', '', '', '', '']],
  'header-only.csv': [pmiHead],
};
for (const [f, rows] of Object.entries(bad)) writeFileSync(path.join(out, 'schedules', 'bad', f), toCsv(rows));
writeFileSync(path.join(out, 'schedules', 'bad', 'not-a-schedule.pdf'), '%PDF-1.4\n% synthetic, not a schedule\n');
console.log(`wrote ${plan.length} mocks, ${Object.keys(profiles.methods).length * 2} templates, ${Object.keys(bad).length + 1} refused samples`);
