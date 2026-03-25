declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

export interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
  item(index: number): SpeechRecognitionResult;
  [Symbol.iterator](): IterableIterator<SpeechRecognitionResult>;
}

export interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [Symbol.iterator](): IterableIterator<SpeechRecognitionAlternative>;
}

export interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

