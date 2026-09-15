import { ApiError } from '../../../utils/ApiError';

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  query?: Record<string, string | number | undefined>;
}

/**
 * Thin fetch wrapper shared by every concrete BrokerAdapter implementation.
 * Keeps HTTP/error-shape concerns out of each broker's business logic.
 */
export abstract class BaseHttpAdapter {
  protected abstract baseUrl: string;

  protected async request<T = unknown>(path: string, options: HttpRequestOptions = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (options.query) {
      Object.entries(options.query).forEach(([key, value]) => {
        if (value !== undefined) url.searchParams.append(key, String(value));
      });
    }

    const response = await fetch(url.toString(), {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }

    if (!response.ok) {
      // Broker APIs vary in how they shape error bodies — try the common
      // field names before falling back to the generic HTTP status text, so
      // the actual reason (e.g. "Invalid Access Token", "route not found")
      // reaches the user instead of being swallowed.
      const upstreamMessage =
        (json as any)?.message ??
        (json as any)?.error?.message ??
        (json as any)?.error_message ??
        (json as any)?.remark ??
        (typeof json === 'string' ? json : undefined);

      throw new ApiError(
        response.status >= 500 ? 502 : 400,
        upstreamMessage
          ? `Broker API error (${response.status}): ${upstreamMessage}`
          : `Broker API error (${response.status}): ${response.statusText}`,
        json,
      );
    }

    return json as T;
  }
}