/// <reference types="astro/client" />

interface Env {
  BAI_CC_CACHE: KVNamespace;
  DATABASE_URL: string;
  ENVIRONMENT: string;
  /** ATSF-Core API base URL (e.g. "https://api.vorion.org") */
  ATSF_API_URL?: string;
  /** API key for authenticated atsf-core requests */
  VORION_API_KEY?: string;
}

declare namespace App {
  interface Locals {
    runtime: {
      env: Env;
    };
  }
}
