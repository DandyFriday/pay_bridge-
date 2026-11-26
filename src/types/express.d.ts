declare namespace Express {
  export interface Request {
    merchant?: {
      id: string;
      name: string;
      email: string;
    };
    apiKey?: {
      id: string;
      prefix: string;
      name: string;
    };
  }
}
