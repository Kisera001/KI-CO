import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';

const DEFAULT_PORT = Number(process.env.OBSIDIAN_BRIDGE_PORT || 3210);
const DEFAULT_HOST = String(process.env.OBSIDIAN_BRIDGE_HOST || '127.0.0.1').trim() || '127.0.0.1';
const FILE_LIST_CACHE_TTL_MS = 10 * 60 * 1000;
const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.obsidian',
  '.trash',
  '.DS_Store',
]);

const fileListCache = new Map();

const now = () => Date.now();

const normSlashes = (value) => String(value || '').replace(/\\/g, '/');

const normalizeFolderPath = (value) => {
  const raw = normSlashes(String(value || '').trim())
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  if (!raw || raw === '.') return '.';
  return raw;
};

const getRelativePath = (rootPath, filePath) => normSlashes(path.relative(rootPath, filePath));

const getFileDir = (rootPath, filePath) => {
  const rel = getRelativePath(rootPath, filePath);
  const dir = normSlashes(path.posix.dirname(rel));
  if (!dir || dir === '.' || dir === '/') return '.';
  return normalizeFolderPath(dir);
};

const isDirectory = async (targetPath) => {
  try {
    const stat = await fs.stat(targetPath);
    return !!stat?.isDirectory?.();
  } catch {
    return false;
  }
};

const findDescendantWithTail = async (baseDir, tailSegments, maxDepth = 2) => {
  const queue = [{ dir: baseDir, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    const candidate = path.join(dir, ...tailSegments);
    if (await isDirectory(candidate)) return candidate;
    if (depth >= maxDepth) continue;
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (IGNORED_DIRS.has(entry.name)) continue;
      queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return null;
};

const resolveRootPath = async (rawPath) => {
  const input = String(rawPath || '').trim();
  if (!input) return null;
  const resolved = path.resolve(input);
  if (await isDirectory(resolved)) return resolved;

  // Heuristic repair: if a middle folder is garbled but a vault tail like ".../Obsidian/Vault" is stable.
  const parsed = path.parse(resolved);
  const segs = resolved
    .slice(parsed.root.length)
    .split(/[\\/]+/)
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  const obsIdx = segs.findIndex((seg) => seg.toLowerCase() === 'obsidian');
  if (obsIdx >= 1 && obsIdx < segs.length - 1) {
    const baseSegments = segs.slice(0, Math.max(1, obsIdx - 1));
    const baseDir = path.join(parsed.root || '', ...baseSegments);
    const tailSegments = segs.slice(obsIdx);
    if (await isDirectory(baseDir)) {
      const repaired = await findDescendantWithTail(baseDir, tailSegments, 2);
      if (repaired) return repaired;
    }
  }
  return null;
};

const toNoteId = (rootPath, filePath) => {
  const rel = getRelativePath(rootPath, filePath);
  return rel.replace(/\.md$/i, '');
};

const stableChunkId = (noteId, index, content) => {
  const h = crypto.createHash('sha1');
  h.update(`${noteId}#${index}#${content.slice(0, 400)}`);
  return `${noteId}#${index}-${h.digest('hex').slice(0, 12)}`;
};

const parseInlineArray = (value) => {
  const raw = String(value || '').trim();
  if (!raw.startsWith('[') || !raw.endsWith(']')) return null;
  const inside = raw.slice(1, -1);
  return inside
    .split(',')
    .map((x) => String(x || '').trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
};

const parseFrontmatter = (raw) => {
  const source = String(raw || '');
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
    return { data: {}, body: source };
  }
  const fmMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) return { data: {}, body: source };
  const fmText = fmMatch[1];
  const body = source.slice(fmMatch[0].length);

  const data = {};
  let listKey = '';

  for (const rawLine of fmText.split(/\r?\n/)) {
    const line = String(rawLine || '');
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const listItem = line.match(/^\s*-\s*(.+)$/);
    if (listItem && listKey) {
      if (!Array.isArray(data[listKey])) data[listKey] = [];
      data[listKey].push(listItem[1].trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) {
      listKey = '';
      continue;
    }
    const key = kv[1].trim();
    const value = kv[2].trim();
    if (!value) {
      data[key] = [];
      listKey = key;
      continue;
    }

    const arr = parseInlineArray(value);
    if (arr) {
      data[key] = arr;
      listKey = '';
      continue;
    }

    data[key] = value.replace(/^['"]|['"]$/g, '');
    listKey = '';
  }

  return { data, body };
};

const STAGE_TOKEN_RE = /v\s*\d+(?:\.\d+){0,3}/ig;

const normalizeStageToken = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  return /^V\d+(?:\.\d+){0,3}$/.test(compact) ? compact : '';
};

const extractStageToken = (value) => {
  const text = String(value || '');
  const m = text.match(STAGE_TOKEN_RE);
  if (!m || m.length === 0) return '';
  return normalizeStageToken(m[0]);
};

const normalizeDateIso = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
};

const FUSION_LOG = '\u878d\u5408\u6838\u65e5\u5fd7';
const GROWTH_LOG = '\u6210\u957f\u65e5\u5fd7';
const GROWTH_PROFILE = '\u6210\u957f\u6863\u6848';

const inferEntryType = (title, frontmatterType) => {
  const explicit = String(frontmatterType || '').trim();
  if (explicit) return explicit;
  const t = String(title || '');
  if (t.includes(FUSION_LOG)) return 'core_stage_log';
  if (t.includes(GROWTH_LOG)) return 'growth_stage_log';
  if (t.includes(GROWTH_PROFILE)) return 'growth_profile';
  return '';
};

const inferImportance = (title, entryType) => {
  const t = String(title || '');
  const ty = String(entryType || '');
  if (ty.includes('core_stage_log')) return 1.7;
  if (t.includes(FUSION_LOG)) return 1.62;
  if (t.includes(GROWTH_LOG)) return 1.52;
  if (t.includes(GROWTH_PROFILE)) return 1.45;
  return 1.25;
};

const normalizeTag = (value) =>
  String(value || '')
    .trim()
    .replace(/^#/, '')
    .replace(/[^\w\u4e00-\u9fa5/_.-]/g, '')
    .trim();

const extractInlineHashtags = (text) => {
  const tags = [];
  const re = /(^|\s)#([\w\u4e00-\u9fa5/_-]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const t = normalizeTag(m[2]);
    if (t) tags.push(t);
  }
  return tags;
};

const cleanObsidianMarkdown = (source) => {
  return String(source || '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ''))
    .replace(/!\[\[([^\]]+)\]\]/g, ' ')
    .replace(/\[\[([^\]]+)\]\]/g, (_, inner) => {
      const raw = String(inner || '').trim();
      if (!raw) return ' ';
      if (raw.includes('|')) {
        const parts = raw.split('|');
        return parts[parts.length - 1].trim() || parts[0].trim();
      }
      return raw.split('#')[0].trim();
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/`{1,3}/g, '')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const chunkByParagraphs = (text, maxChunkChars = 1200, chunkOverlap = 120) => {
  const maxLen = Math.max(300, Math.min(8000, Math.floor(Number(maxChunkChars) || 1200)));
  const overlap = Math.max(0, Math.min(600, Math.floor(Number(chunkOverlap) || 120)));
  const parts = String(text || '')
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean);

  const chunks = [];
  let current = '';

  const pushCurrent = () => {
    const clean = current.trim();
    if (clean) chunks.push(clean);
    current = '';
  };

  for (const part of parts) {
    if (part.length > maxLen) {
      pushCurrent();
      let start = 0;
      while (start < part.length) {
        const end = Math.min(part.length, start + maxLen);
        const piece = part.slice(start, end).trim();
        if (piece) chunks.push(piece);
        if (end >= part.length) break;
        start = Math.max(end - overlap, start + 1);
      }
      continue;
    }

    const candidate = current ? `${current}\n\n${part}` : part;
    if (candidate.length <= maxLen) {
      current = candidate;
    } else {
      pushCurrent();
      current = part;
    }
  }
  pushCurrent();
  return chunks.filter(Boolean);
};

const parseNoteToChunks = async (rootPath, filePath, options) => {
  const raw = await fs.readFile(filePath, 'utf8');
  const stat = await fs.stat(filePath);
  const { data: frontmatter, body } = parseFrontmatter(raw);
  const cleaned = cleanObsidianMarkdown(body);
  if (!cleaned) return [];

  const noteId = toNoteId(rootPath, filePath);
  const fileName = path.basename(filePath, path.extname(filePath));
  const title = String(frontmatter.title || fileName || noteId).trim();
  const stage = normalizeStageToken(frontmatter.stage) || extractStageToken(title);
  const stageName = String(frontmatter.name || '').trim();
  const entryType = inferEntryType(title, frontmatter.type);
  const entryDate = normalizeDateIso(frontmatter.date);
  const importance = inferImportance(title, entryType);
  const fmTags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags
    : typeof frontmatter.tags === 'string'
      ? frontmatter.tags.split(/[,;|]/)
      : [];
  const fmAliases = Array.isArray(frontmatter.aliases)
    ? frontmatter.aliases
    : typeof frontmatter.aliases === 'string'
      ? frontmatter.aliases.split(/[,;|]/)
      : [];
  const inlineTags = extractInlineHashtags(cleaned);
  const tags = Array.from(
    new Set([
      ...fmTags,
      ...inlineTags,
      stage,
      entryType,
    ].map(normalizeTag).filter(Boolean))
  ).slice(0, 30);
  const aliases = Array.from(
    new Set([
      ...fmAliases,
      stageName,
      entryDate,
    ].map((x) => String(x || '').trim()).filter(Boolean))
  ).slice(0, 20);

  const chunks = chunkByParagraphs(cleaned, options.maxChunkChars, options.chunkOverlap);
  return chunks.map((content, idx) => ({
    id: stableChunkId(noteId, idx, content),
    noteId,
    parentId: `obsidian:${noteId}`,
    title,
    content,
    stage,
    stageName,
    entryType,
    entryDate,
    importance,
    tags,
    aliases,
    createdAt: Number(stat.mtimeMs || Date.now()),
    sourcePath: normSlashes(path.relative(rootPath, filePath)),
  }));
};

const collectMarkdownFiles = async (rootPath) => {
  const rootOk = await isDirectory(rootPath);
  if (!rootOk) {
    throw new Error(`Obsidian root not found or not a directory: ${rootPath}`);
  }
  const stack = [rootPath];
  const out = [];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (/\.md$/i.test(entry.name)) out.push(fullPath);
    }
  }
  out.sort((a, b) => a.localeCompare(b, 'en'));
  return out;
};

const getCachedFiles = async (rootPath) => {
  const key = path.resolve(rootPath);
  const hit = fileListCache.get(key);
  if (hit && now() - hit.ts < FILE_LIST_CACHE_TTL_MS) {
    return hit.files;
  }
  const files = await collectMarkdownFiles(key);
  fileListCache.set(key, { ts: now(), files });
  return files;
};

const parseIncludeFolders = (input) => {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((x) => normalizeFolderPath(String(x || '')))
        .filter(Boolean)
    )
  );
};

const matchFolder = (rootPath, filePath, includeFolders) => {
  if (!includeFolders || includeFolders.length === 0) return true;
  const rel = getRelativePath(rootPath, filePath).replace(/\.md$/i, '');
  const relNorm = normalizeFolderPath(rel);
  const fileDir = getFileDir(rootPath, filePath);
  return includeFolders.some((folder) => {
    if (folder === '.') return fileDir === '.';
    if (fileDir === folder || fileDir.startsWith(`${folder}/`)) return true;
    if (relNorm === folder || relNorm.startsWith(`${folder}/`)) return true;
    return false;
  });
};

const filterFilesByFolders = (rootPath, files, includeFolders) => {
  if (!includeFolders || includeFolders.length === 0) return files;
  return files.filter((filePath) => matchFolder(rootPath, filePath, includeFolders));
};

const listFolderStats = (rootPath, files) => {
  const folderCounter = new Map();
  for (const filePath of files) {
    const dir = getFileDir(rootPath, filePath);
    folderCounter.set(dir, (folderCounter.get(dir) || 0) + 1);
  }
  return Array.from(folderCounter.entries())
    .sort((a, b) => {
      if (a[0] === '.') return -1;
      if (b[0] === '.') return 1;
      return a[0].localeCompare(b[0], 'en');
    })
    .map(([folder, fileCount]) => ({
      path: folder,
      label: folder === '.' ? '(root)' : folder,
      fileCount,
    }));
};

const readJsonBody = async (req) => {
  const buffers = [];
  for await (const chunk of req) buffers.push(chunk);
  if (buffers.length === 0) return {};
  const text = Buffer.concat(buffers).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

const writeJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(body);
};

const getLanIpv4List = () => {
  const nets = os.networkInterfaces();
  const out = [];
  for (const key of Object.keys(nets)) {
    const arr = nets[key] || [];
    for (const addr of arr) {
      if (!addr || addr.family !== 'IPv4' || addr.internal) continue;
      out.push(addr.address);
    }
  }
  return Array.from(new Set(out));
};
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    writeJson(res, 200, { ok: true });
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    writeJson(res, 200, { ok: true, service: 'obsidian-bridge', ts: now() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/obsidian/files') {
    const body = await readJsonBody(req);
    const rootPath = String(body.rootPath || '').trim();
    if (!rootPath) {
      writeJson(res, 400, { ok: false, error: 'rootPath is required' });
      return;
    }
    try {
      const resolvedRoot = await resolveRootPath(rootPath);
      if (!resolvedRoot) {
        writeJson(res, 400, { ok: false, error: `invalid rootPath: ${rootPath}` });
        return;
      }
      const includeFolders = parseIncludeFolders(body.includeFolders);
      const files = await getCachedFiles(resolvedRoot);
      const folderStats = listFolderStats(resolvedRoot, files);
      const filteredFiles = filterFilesByFolders(resolvedRoot, files, includeFolders);
      writeJson(res, 200, {
        ok: true,
        totalFiles: filteredFiles.length,
        allFiles: files.length,
        rootPath: resolvedRoot,
        includeFolders,
        folders: folderStats,
      });
    } catch (error) {
      writeJson(res, 500, { ok: false, error: String(error?.message || error) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/obsidian/chunks') {
    const body = await readJsonBody(req);
    const rootPath = String(body.rootPath || '').trim();
    if (!rootPath) {
      writeJson(res, 400, { ok: false, error: 'rootPath is required' });
      return;
    }
    const fileOffset = Math.max(0, Number(body.fileOffset || 0));
    const fileLimit = Math.max(1, Math.min(400, Number(body.fileLimit || 80)));
    const maxChunkChars = Math.max(300, Math.min(8000, Number(body.maxChunkChars || 1200)));
    const chunkOverlap = Math.max(0, Math.min(600, Number(body.chunkOverlap || 120)));
    const includeFolders = parseIncludeFolders(body.includeFolders);

    try {
      const resolvedRoot = await resolveRootPath(rootPath);
      if (!resolvedRoot) {
        writeJson(res, 400, { ok: false, error: `invalid rootPath: ${rootPath}` });
        return;
      }
      const allFiles = await getCachedFiles(resolvedRoot);
      const files = filterFilesByFolders(resolvedRoot, allFiles, includeFolders);
      const batch = files.slice(fileOffset, fileOffset + fileLimit);
      let chunks = [];
      for (const filePath of batch) {
        const noteChunks = await parseNoteToChunks(resolvedRoot, filePath, {
          maxChunkChars,
          chunkOverlap,
        });
        chunks = chunks.concat(noteChunks);
      }
      writeJson(res, 200, {
        ok: true,
        totalFiles: files.length,
        fileOffset,
        fileLimit,
        nextOffset: Math.min(files.length, fileOffset + batch.length),
        processedFiles: batch.length,
        includeFolders,
        chunks,
      });
    } catch (error) {
      writeJson(res, 500, { ok: false, error: String(error?.message || error) });
    }
    return;
  }

  writeJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
  console.log(`[Obsidian Bridge] listening on http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
  if (DEFAULT_HOST === '0.0.0.0') {
    const ips = getLanIpv4List();
    if (ips.length > 0) {
      for (const ip of ips) {
        console.log(`[Obsidian Bridge] LAN URL: http://${ip}:${DEFAULT_PORT}`);
      }
    } else {
      console.log('[Obsidian Bridge] LAN mode enabled, but no non-internal IPv4 detected.');
    }
  }
  console.log('[Obsidian Bridge] endpoints: GET /health, POST /api/obsidian/files, POST /api/obsidian/chunks');
});
