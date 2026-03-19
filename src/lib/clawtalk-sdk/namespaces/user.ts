import { ENDPOINTS } from '../endpoints.js';
import type { UserMeResponse } from '../types.js';
import type { RequestFn } from './calls.js';

export class UserNamespace {
  constructor(private readonly request: RequestFn) {}

  async me(): Promise<UserMeResponse> {
    return this.request<UserMeResponse>('GET', ENDPOINTS.getMe.path);
  }

  async updateMe(fields: Record<string, unknown>): Promise<UserMeResponse> {
    return this.request<UserMeResponse>('PATCH', ENDPOINTS.updateMe.path, { body: fields });
  }
}
