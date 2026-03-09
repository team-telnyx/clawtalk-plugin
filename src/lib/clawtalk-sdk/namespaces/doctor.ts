/**
 * Doctor namespace — server-side health check endpoints.
 */

import { ENDPOINTS, resolve } from '../endpoints.js';
import type { RequestFn } from './calls.js';

export interface DoctorCheckResult {
  readonly [key: string]: unknown;
}

export class DoctorNamespace {
  constructor(private readonly request: RequestFn) {}

  async critical(): Promise<DoctorCheckResult> {
    return this.request<DoctorCheckResult>('GET', resolve(ENDPOINTS.doctorCritical.path));
  }

  async warnings(): Promise<DoctorCheckResult> {
    return this.request<DoctorCheckResult>('GET', resolve(ENDPOINTS.doctorWarnings.path));
  }

  async recommended(): Promise<DoctorCheckResult> {
    return this.request<DoctorCheckResult>('GET', resolve(ENDPOINTS.doctorRecommended.path));
  }

  async infra(): Promise<DoctorCheckResult> {
    return this.request<DoctorCheckResult>('GET', resolve(ENDPOINTS.doctorInfra.path));
  }
}
