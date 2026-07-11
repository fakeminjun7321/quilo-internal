export interface QuiloOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export interface Job {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted" | string;
  type?: string;
  model?: string;
  filename?: string | null;
  fileId?: string | null;
  error?: string | null;
  progress?: unknown[];
  downloadUrl?: string | null;
}

export class QuiloError extends Error {
  status?: number;
  code?: string;
  requestId?: string;
  body?: unknown;
}

export class Quilo {
  constructor(options?: QuiloOptions);
  account(): Promise<Record<string, unknown>>;
  features(query?: string): Promise<Array<Record<string, unknown>>>;
  jobs: {
    list(): Promise<Job[]>;
    retrieve(id: string): Promise<Job>;
    abort(id: string): Promise<Record<string, unknown>>;
    wait(id: string, options?: { timeoutMs?: number; pollIntervalMs?: number }): Promise<Job>;
    download(id: string, destination: string, options?: { fileIndex?: number }): Promise<string>;
  };
  pdf: {
    estimate(file: string, options?: { mode?: "auto" | "inplace" | "retypeset"; model?: string }): Promise<Record<string, unknown>>;
    translate(files: string | string[], options?: {
      mode?: "auto" | "inplace" | "retypeset";
      model?: string;
      restoreOnly?: boolean;
      chartRedraw?: boolean;
      background?: boolean;
      notifyEmail?: boolean;
      idempotencyKey?: string;
    }): Promise<Job>;
  };
  reports: {
    create(options: {
      type: string;
      format?: "docx" | "hwpx";
      model?: string;
      fields?: Record<string, string | number | boolean>;
      files?: Record<string, string | string[]>;
      idempotencyKey?: string;
    }): Promise<Job>;
  };
  conversions: {
    docxToHwpx(file: string, destination: string): Promise<string>;
  };
  studios: {
    vibeConfig(): Promise<Record<string, unknown>>;
    generateVibe(idea: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
    refineVibe(message: string, result: Record<string, unknown>, options?: { history?: Array<Record<string, unknown>>; model?: string }): Promise<Record<string, unknown>>;
    generatePhysics(topic: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  fileChat: {
    access(): Promise<Record<string, unknown>>;
    message(message: string, options?: { files?: string[]; history?: Array<Record<string, unknown>>; model?: string }): Promise<string>;
  };
  knowledge: {
    lab(): Promise<Array<Record<string, unknown>>>;
    labEntry(id: string): Promise<Record<string, unknown>>;
  };
  community: {
    posts(options?: { category?: string }): Promise<Array<Record<string, unknown>>>;
    createPost(input: { title: string; body: string; category?: string }): Promise<Record<string, unknown>>;
    comments(postId: string): Promise<Array<Record<string, unknown>>>;
    createComment(postId: string, body: string): Promise<Record<string, unknown>>;
    vote(postId: string): Promise<Record<string, unknown>>;
  };
}
