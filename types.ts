export interface Recording {
  id: string;
  blob: Blob;
  url: string;
  timestamp: number;
  duration: number; // in seconds
  name: string;
  transcription?: string;
  summary?: string;
}

export enum RecorderState {
  IDLE = 'IDLE',
  PREPARING = 'PREPARING',
  RECORDING = 'RECORDING',
  PAUSED = 'PAUSED',
  PROCESSING = 'PROCESSING', // Analyzing with AI
}

export interface AudioSourceConfig {
  mic: boolean;
  system: boolean;
}
