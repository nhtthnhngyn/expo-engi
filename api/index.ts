/**
 * Public surface of the export API package.
 */

export { ExportService, DOCX_CONTENT_TYPE, SYNC_NODE_LIMIT, filenameFor } from './export-service.js';
export type { ExportRequest, ExportOutput, ExportServiceOptions, Principal } from './export-service.js';
export { createRouter, principalFrom } from './routes.js';
export type { ApiRequest, ApiResponse, RouterOptions } from './routes.js';
export { createExportServer } from './server.js';
export { InMemoryAuditLog, FileAuditLog } from './audit-log.js';
export type { AuditEntry, AuditLog } from './audit-log.js';
export { InMemoryJobStore } from './jobs.js';
export type { Job, JobStatus, JobStore } from './jobs.js';
export { ROLE_POLICIES, canExportPhase, assertCanExportPhase, isKnownRole } from './rbac.js';
export type { Role, RolePolicy } from './rbac.js';
export { isEntitled, assertEntitled } from './entitlements.js';
export { statusFor, toHttpError } from './http-errors.js';
