#!/usr/bin/env node
/**
 * Site Crawler for Meadowbrook Dartington
 * 
 * This script crawls the existing Squarespace site and extracts:
 * - Page content (HTML -> Markdown)
 * - Images
 * - PDFs and documents
 * - Site structure
 * 
 * Usage: 
 *   npm run crawl
 *   node scripts/crawl-site.mjs [--dry-run] [--verbose]
 */

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const BASE_URL = 'https://www.meadowbrookdartington.org';

// Known pages from the site
const PAGES_TO_CRAWL = [
  '/',
  '/about',
  '/pool',
  '/bike-track',
  '/snooker-room',
  '/large-room',
  '/small-room',
  '/playground',
  '/playing-fields',
  '/woodland-and-brook',
  '/energy-hub',
  '/contact',
  '/subscribe-to-updates',
  '/volunteer',
  '/be-a-trustee',
  '/meadowchat',
];

// Document URLs found on the site
const DOCUMENTS = [
  '/s/DRA-vision.pdf',
  '/s/Dartington-Recreation-Association-Constitution-2022.pdf',
  '/s/handbook-and-rules-2023.pdf',
  '/s/Dartington-Recreation-Association-Constitution-2016.pdf',
  '/s/handbook-and-rules-2016.pdf',
  '/s/lease.pdf',
  '/s/leasea1.pdf',
  '/s/leasea2.pdf',
  '/s/leasea3.pdf',
  '/s/leasea4.pdf',
  // Meeting minutes
  '/s/2024-06-11.pdf',
  '/s/2024-03-12.pdf',
  '/s/2024-01-30.pdf',
  '/s/2023-09-26-agm.pdf',
  '/s/2023-05-23.pdf',
  '/s/2023-03-14.pdf',
  '/s/2022-11-29.pdf',
  '/s/2022-01-25.pdf',
  '/s/2021-09-14.pdf',
  '/s/2021-04-27-agm.pdf',
  '/s/2019-06-04.pdf',
  '/s/2019-03-26.pdf',
  '/s/2019-02-12.pdf',
  '/s/2018-09-13.pdf',
  '/s/2018-06-07.pdf',
  '/s/2018-02-10.pdf',
  '/s/2017-11-17-agm.pdf',
  '/s/2017-09-14.pdf',
  '/s/2017-05-04.pdf',
  '/s/2017-03-02.pdf',
  '/s/2017-01-26.pdf',
  '/s/2016-12-19.pdf',
  '/s/2016-11-24.pdf',
  '/s/2016-10-20.pdf',
];

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

function log(...messages) {
  console.log('[Crawler]', ...messages);
}

function verbose(...messages) {
  if (VERBOSE) console.log('[Verbose]', ...messages);
}

/**
 * Fetch a page and return its HTML content
 */
async function fetchPage(url) {
  try {
    verbose(`Fetching: ${url}`);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'MeadowbrookMigrationBot/1.0',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('text/html')) {
      return { type: 'html', content: await response.text(), url: response.url };
    } else if (contentType.includes('application/pdf')) {
      return { type: 'pdf', content: await response.arrayBuffer(), url: response.url };
    } else if (contentType.includes('image/')) {
      return { type: 'image', content: await response.arrayBuffer(), url: response.url };
    }
    
    return { type: 'unknown', content: await response.text(), url: response.url };
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error.message);
    return null;
  }
}

/**
 * Extract text content from HTML (basic extraction)
 */
function extractContent(html) {
  // Remove script and style tags
  let cleaned = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Extract title
  const titleMatch = cleaned.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(' — Meadowbrook + the DRA', '').trim() : '';
  
  // Extract main content area (Squarespace specific)
  const mainMatch = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const mainContent = mainMatch ? mainMatch[1] : cleaned;
  
  // Extract images
  const images = [];
  const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    images.push(imgMatch[1]);
  }
  
  // Extract links to PDFs
  const pdfs = [];
  const pdfRegex = /href="([^"]+\.pdf)"/gi;
  let pdfMatch;
  while ((pdfMatch = pdfRegex.exec(html)) !== null) {
    pdfs.push(pdfMatch[1]);
  }
  
  // Basic HTML to text (very simplified)
  let text = mainContent
    .replace(/<h1[^>]*>/gi, '\n# ')
    .replace(/<h2[^>]*>/gi, '\n## ')
    .replace(/<h3[^>]*>/gi, '\n### ')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<p[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi, '[$2]($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  return { title, text, images, pdfs };
}

/**
 * Convert page path to content file path
 */
function getContentPath(pagePath) {
  const slug = pagePath === '/' ? 'index' : pagePath.slice(1);
  return path.join(PROJECT_ROOT, 'src/content/pages', `${slug}.md`);
}

/**
 * Save extracted content as markdown
 */
async function saveContent(pagePath, content) {
  const filePath = getContentPath(pagePath);
  const dir = path.dirname(filePath);
  
  const frontmatter = `---
title: "${content.title}"
slug: "${pagePath === '/' ? '' : pagePath.slice(1)}"
crawledAt: "${new Date().toISOString()}"
originalUrl: "${BASE_URL}${pagePath}"
images: ${JSON.stringify(content.images)}
documents: ${JSON.stringify(content.pdfs)}
---

`;
  
  const markdown = frontmatter + content.text;
  
  if (DRY_RUN) {
    log(`[DRY RUN] Would save: ${filePath}`);
    verbose(`Content preview:\n${markdown.slice(0, 500)}...`);
  } else {
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, markdown, 'utf-8');
    log(`Saved: ${filePath}`);
  }
}

/**
 * Download a document/asset
 */
async function downloadDocument(docPath) {
  const url = `${BASE_URL}${docPath}`;
  const result = await fetchPage(url);
  
  if (!result || result.type === 'unknown') {
    console.error(`Failed to download: ${docPath}`);
    return;
  }
  
  const fileName = path.basename(docPath);
  const destPath = path.join(PROJECT_ROOT, 'public/documents', fileName);
  
  if (DRY_RUN) {
    log(`[DRY RUN] Would download: ${url} -> ${destPath}`);
  } else {
    await mkdir(path.dirname(destPath), { recursive: true });
    await writeFile(destPath, Buffer.from(result.content));
    log(`Downloaded: ${fileName}`);
  }
}

/**
 * Generate a site structure report
 */
async function generateReport(results) {
  const report = {
    crawledAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    pages: results.pages,
    documents: results.documents,
    images: [...new Set(results.images)],
    errors: results.errors,
  };
  
  const reportPath = path.join(PROJECT_ROOT, 'crawl-report.json');
  
  if (DRY_RUN) {
    log(`[DRY RUN] Would save report to: ${reportPath}`);
  } else {
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    log(`Report saved: ${reportPath}`);
  }
  
  return report;
}

/**
 * Main crawl function
 */
async function crawl() {
  log('Starting site crawl...');
  log(`Base URL: ${BASE_URL}`);
  log(`Dry run: ${DRY_RUN}`);
  
  const results = {
    pages: [],
    documents: [],
    images: [],
    errors: [],
  };
  
  // Crawl pages
  log('\n--- Crawling Pages ---');
  for (const pagePath of PAGES_TO_CRAWL) {
    const url = `${BASE_URL}${pagePath}`;
    const result = await fetchPage(url);
    
    if (result && result.type === 'html') {
      const content = extractContent(result.content);
      await saveContent(pagePath, content);
      
      results.pages.push({
        path: pagePath,
        title: content.title,
        imagesCount: content.images.length,
        documentsCount: content.pdfs.length,
      });
      
      results.images.push(...content.images);
    } else if (result && result.url !== url) {
      // Page redirected (like booking pages)
      log(`Redirect: ${pagePath} -> ${result.url}`);
      results.pages.push({
        path: pagePath,
        redirectsTo: result.url,
        isBookingPage: result.url.includes('scheduling'),
      });
    } else {
      results.errors.push({ path: pagePath, error: 'Failed to fetch' });
    }
    
    // Be nice to the server
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Download documents
  log('\n--- Downloading Documents ---');
  for (const docPath of DOCUMENTS) {
    await downloadDocument(docPath);
    results.documents.push(docPath);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  // Generate report
  log('\n--- Generating Report ---');
  const report = await generateReport(results);
  
  log('\n=== Crawl Complete ===');
  log(`Pages crawled: ${results.pages.length}`);
  log(`Documents downloaded: ${results.documents.length}`);
  log(`Unique images found: ${[...new Set(results.images)].length}`);
  log(`Errors: ${results.errors.length}`);
  
  return report;
}

// Run if called directly
crawl().catch(console.error);
