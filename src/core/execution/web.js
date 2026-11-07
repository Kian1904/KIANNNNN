import { searchWeb } from '../../search.js';
import { fetchWebPage } from '../../web-fetch.js';

export async function executeSearch(query, deps = {}) {
  return (deps.searchWeb || searchWeb)(query);
}

export async function executeFetch(url, deps = {}) {
  return (deps.fetchWebPage || fetchWebPage)(url);
}
