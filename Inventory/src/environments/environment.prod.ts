const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
const basePort = 3000;

export const environment = {
  production: true,
  apiRoot: `${protocol}//${host}:${basePort}`,
  apiBase: `${protocol}//${host}:${basePort}/api`
};
