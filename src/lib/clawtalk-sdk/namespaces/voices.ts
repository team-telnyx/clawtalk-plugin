import { ENDPOINTS } from '../endpoints.js';
import type { VoicesResponse } from '../types.js';
import type { RequestFn } from './calls.js';

export class VoicesNamespace {
  constructor(private readonly request: RequestFn) {}

  async list(provider?: string): Promise<VoicesResponse> {
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : '';
    return this.request<VoicesResponse>('GET', `${ENDPOINTS.listVoices.path}${query}`);
  }
}
