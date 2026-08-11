/**
 * Agency-crawl seam (docs/API.md): admin actions + /api/crawl-tick call THIS,
 * never the data backend directly (tests/architecture.test.ts). The engine
 * lives in data/db/crawl.ts.
 */
export {
  crawlTick,
  enqueueOrgCrawl,
  processImportJobs,
  type CrawlEnqueueResult,
  type CrawlProcessResult,
  type CrawlTickResult,
} from '@/app/data/db/crawl';
