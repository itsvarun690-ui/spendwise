import { registerPlugin } from '@capacitor/core';

export interface ConfirmedDraft {
  amount: string;
  spent_on: string;
  category_id: string;
  payment_method: string;
  description: string;
}

export interface LocalCandidate {
  id: string;
  fingerprint: string;
  amount: string;
  merchant: string;
  spent_on: string;
  event_time: number;
  reference: string;
  bank: string;
  source: string;
  source_label: string;
  confirmedUserId?: string;
  confirmedByUser?: boolean;
  status: 'confirmed_debit' | 'review' | 'reconciliation';
  state: 'pending' | 'proceed_queued' | 'saved' | 'skipped';
  confirmedDraft?: ConfirmedDraft;
}

export interface DetectionSettings {
  paused: boolean;
  selectedSources: string[];
  smsEnabled: boolean;
}

interface NativeTransactionsPlugin {
  getCandidates(): Promise<DetectionSettings & { candidates: LocalCandidate[] }>;
  skip(options: { id: string }): Promise<void>;
  markSaved(options: { id: string }): Promise<void>;
  queueConfirmed(options: { id: string; userId: string; draft: ConfirmedDraft; userValidated: boolean }): Promise<void>;
  configure(options: { paused: boolean; packages: string[]; smsEnabled: boolean }): Promise<DetectionSettings>;
  getLaunchCandidate(): Promise<{ candidateId: string | null }>;
  setAuthSession(options: {
    supabaseUrl: string;
    publishableKey: string;
    accessToken: string;
    refreshToken: string;
    userId: string;
  }): Promise<void>;
  clearAuthSession(): Promise<void>;
  getAuthSession(): Promise<{ accessToken: string; refreshToken: string } | null>;
  openNotificationAccess(): Promise<void>;
}

export const NativeTransactions = registerPlugin<NativeTransactionsPlugin>('SpendwiseTransactions');
export const isNativeAndroid = () => /android/i.test(navigator.userAgent) && !!(window as Window & { Capacitor?: unknown }).Capacitor;
