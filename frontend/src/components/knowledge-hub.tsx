"use client";

import {
  Archive,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Download,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Tag,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { KnowledgeEntry as DemoKnowledgeEntry, KnowledgeCategory } from "@/lib/business";
import type { Asset, Product } from "@/lib/catalog";
import { createProductViaApi } from "@/lib/client/backend-api";
import type { DataSourceKind } from "@/lib/data-snapshot";
import { knowledgeListResponseSchema, type KnowledgeEntry } from "@/lib/knowledge/contracts";
import { useModelCatalog } from "@/hooks/use-model-catalog";
import { useModelHealth } from "@/hooks/use-model-health";
import styles from "./knowledge-hub.module.css";
import { ModelRuntimeControls } from "./model-runtime-controls";

export type KnowledgeHubProps = {
  /** Seed entries remain visibly marked as demo knowledge and never mix into uploaded counts. */
  initialEntries: Array<KnowledgeEntry | DemoKnowledgeEntry>;
  products?: Product[];
  assets?: Array<Asset & { productId: string; productName: string }>;
  dataSource?: DataSourceKind;
  initialQuery?: string;
  onOpenProduct?: (product: Product) => void;
  onToast: (message: string) => void;
};

type ApiError = { error?: { message?: string } };
type KnowledgeCategoryFilter = "全部" | KnowledgeCategory;

const categories: Array<KnowledgeCategoryFilter> = [
  "全部", "产品档案", "产品图片", "尺寸图", "参数表", "PDF资料", "证书", "案例", "视频", "说明书", "聊天记录",
  "FAQ", "销售话术", "产品知识", "公司知识", "政策", "文档解析",
];

function assetCategory(type: Asset["type"]): KnowledgeCategory {
  if (type === "图片") return "产品图片";
  if (type === "PDF") return "PDF资料";
  return type;
}

type DemoViewEntry = KnowledgeEntry & { demoContent: string };

function demoEntry(entry: DemoKnowledgeEntry): DemoViewEntry {
  const demoTimestamp = /^\d{4}-\d{2}-\d{2}/.test(entry.updatedAt) ? entry.updatedAt : "演示数据";
  return {
    id: `demo-${entry.id}`,
    originalName: `${entry.title}.demo`,
    mimeType: "application/json",
    extension: "demo",
    sizeBytes: entry.content.length,
    sizeLabel: "演示数据",
    sha256Prefix: "000000000000",
    uploadedAt: demoTimestamp,
    updatedAt: demoTimestamp,
    classificationStatus: entry.status === "已发布" ? "classified" : "pending",
    classificationSource: "none",
    category: entry.category,
    title: entry.title,
    summary: entry.summary,
    tags: entry.tags,
    confidence: null,
    classificationError: null,
    parseStatus: "parsed",
    parseError: null,
    characters: entry.content.length,
    classificationCharacters: Math.min(4_000, entry.content.length),
    pages: null,
    truncated: false,
    hasText: true,
    source: "demo",
    version: entry.version,
    owner: entry.owner,
    downloadUrl: "",
    textPreview: entry.content.slice(0, 1_200),
    demoContent: entry.content,
  };
}

function isUploadedEntry(entry: KnowledgeEntry | DemoKnowledgeEntry): entry is KnowledgeEntry {
  return "source" in entry;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function statusLabel(entry: KnowledgeEntry) {
  if (entry.source === "demo") return "演示知识";
  if (entry.classificationStatus === "classified" && entry.classificationSource === "manual") return "已人工确认";
  if (entry.classificationError) return entry.category ? "已有分类 · 重试失败" : "待分类 · 可重试";
  if (entry.classificationStatus === "classified") return "已分类待确认";
  if (entry.classificationStatus === "pending") return "待分类 · 可重试";
  return "仅归档未理解";
}

export function KnowledgeHub({ initialEntries, products = [], assets = [], dataSource = "json", initialQuery = "", onOpenProduct, onToast }: KnowledgeHubProps) {
  const [uploaded, setUploaded] = useState<KnowledgeEntry[]>([]);
  const [summary, setSummary] = useState<ReturnType<typeof emptySummary>>(emptySummary());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<KnowledgeCategoryFilter>("全部");
  const [selectedId, setSelectedId] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [retryingId, setRetryingId] = useState<string>();
  const [catalogProducts, setCatalogProducts] = useState(products);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { models, modelProfileId, selectedModel, selectModel, loading: loadingModels, error: modelError, refresh: refreshModels } = useModelCatalog();
  const { health, checking: checkingHealth, refresh: refreshHealth } = useModelHealth(modelProfileId);
  const demoEntries = useMemo(() => initialEntries.filter((entry): entry is DemoKnowledgeEntry => !isUploadedEntry(entry)).map(demoEntry), [initialEntries]);

  async function loadKnowledge() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/knowledge?limit=200", { cache: "no-store", headers: { Accept: "application/json" } });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error((payload as ApiError)?.error?.message || `知识库返回 ${response.status}`);
      const parsed = knowledgeListResponseSchema.parse(payload);
      const entries = [...parsed.data];
      for (let offset = 200; offset < Math.min(parsed.summary.total, 500); offset += 200) {
        const page = await fetch(`/api/v1/knowledge?limit=200&offset=${offset}`, { cache: "no-store", headers: { Accept: "application/json" } });
        if (!page.ok) throw new Error(`知识库后续页面返回 ${page.status}`);
        entries.push(...knowledgeListResponseSchema.parse(await page.json()).data);
      }
      setUploaded([...new Map(entries.map((entry) => [entry.id, entry])).values()]);
      setSummary(parsed.summary);
      setSelectedId((current) => current && entries.some((entry) => entry.id === current) ? current : entries[0]?.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "知识库读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadKnowledge(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const selected = uploaded.find((entry) => entry.id === selectedId) ?? uploaded[0];
  const visibleEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return uploaded.filter((entry) => {
      const categoryMatch = category === "全部" || entry.category === category;
      const queryMatch = !normalized || `${entry.originalName} ${entry.title} ${entry.summary} ${entry.tags.join(" ")}`.toLowerCase().includes(normalized);
      return categoryMatch && queryMatch;
    });
  }, [category, query, uploaded]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleProducts = useMemo(() => catalogProducts.filter((product) => {
    if (category !== "全部" && category !== "产品档案" && category !== "产品知识") return false;
    return !normalizedQuery || `${product.name} ${product.model} ${product.sku} ${product.category} ${product.family} ${product.power} ${product.material} ${product.dimensions} ${product.scenarios.join(" ")} ${product.supplier}`.toLowerCase().includes(normalizedQuery);
  }), [catalogProducts, category, normalizedQuery]);
  const visibleAssets = useMemo(() => assets.filter((asset) => {
    if (category !== "全部" && assetCategory(asset.type) !== category) return false;
    return !normalizedQuery || `${asset.name} ${asset.productName} ${asset.type}`.toLowerCase().includes(normalizedQuery);
  }), [assets, category, normalizedQuery]);
  const maxCategoryCount = Math.max(1, ...summary.byCategory.map((item) => item.count));
  const healthLabel = checkingHealth ? "检测中" : health?.reachable ? health.connectionKind === "protocol-mock" ? "协议模拟" : "已连接" : selectedModel?.configured ? "未连接" : "未配置";

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    let completed = 0;
    try {
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append("file", file);
        body.append("modelProfileId", modelProfileId);
        const response = await fetch("/api/v1/knowledge", { method: "POST", body });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error((payload as ApiError)?.error?.message || `${file.name} 上传失败`);
        completed += 1;
      }
      onToast(`${completed} 个文件已保存，正文文件会自动分类；不可解析文件仅归档。`);
      await loadKnowledge();
    } catch (caught) {
      onToast(caught instanceof Error ? caught.message : "上传失败");
      await loadKnowledge();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function retryClassification(entry: KnowledgeEntry) {
    if (entry.source !== "uploaded" || !entry.hasText) return;
    setRetryingId(entry.id);
    try {
      const response = await fetch(`/api/v1/knowledge/${encodeURIComponent(entry.id)}/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelProfileId }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error((payload as ApiError)?.error?.message || "分类重试失败");
      onToast((payload as { meta?: { classified?: boolean } }).meta?.classified ? "模型分类已更新" : "模型暂时不可用，文件已保留待重试");
      await loadKnowledge();
    } catch (caught) {
      onToast(caught instanceof Error ? caught.message : "分类重试失败");
    } finally {
      setRetryingId(undefined);
    }
  }

  async function confirmClassification(entry: KnowledgeEntry, nextCategory: string) {
    if (!nextCategory || entry.source !== "uploaded") return;
    try {
      const response = await fetch(`/api/v1/knowledge/${encodeURIComponent(entry.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: nextCategory, status: "classified" }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error((payload as ApiError)?.error?.message || "人工确认失败");
      onToast("分类已人工确认；确认后的正文才会进入智能搜索");
      await loadKnowledge();
    } catch (caught) {
      onToast(caught instanceof Error ? caught.message : "人工确认失败");
    }
  }

  return (
    <div className={styles.knowledgeHub}>
      <section className={styles.topPanel}>
        <div className={styles.topCopy}>
          <span className={styles.eyebrow}><Sparkles size={14} /> 本地知识资产</span>
          <h2>任何文件先保存，再让模型整理</h2>
          <p>原件保存在本机 UUID 文件名目录；能解析的正文交给所选模型自动分类，图片、音视频和未知二进制会明确标记为“仅归档未理解”。</p>
        </div>
        <div className={styles.modelControls}>
          <label><span>分类模型</span><select aria-label="知识库分类模型" value={modelProfileId} disabled={loadingModels || models.length === 0} onChange={(event) => selectModel(event.target.value)}>{models.length ? models.map((model) => <option value={model.id} key={model.id}>{model.label} · {model.id === modelProfileId ? healthLabel : model.reachable ? "已连接" : model.configured ? "未连接" : "未配置"}</option>) : <option value={modelProfileId}>正在读取模型列表…</option>}</select></label>
          <button className={styles.refreshButton} onClick={() => { refreshModels(); refreshHealth(); }} aria-label="刷新分类模型连接" title="刷新模型连接"><RefreshCw size={15} /></button>
          <small className={health?.reachable ? styles.connected : styles.disconnected}>{healthLabel}</small>
        </div>
        {modelError && <p className={styles.inlineWarning}>{modelError}</p>}
      </section>

      <ModelRuntimeControls models={models} modelProfileId={modelProfileId} disabled={uploading || loadingModels} onModelChange={selectModel} />
      <section className={styles.unifiedToolbarPanel} aria-label="统一知识库筛选">
        <div className={styles.toolbar}>
          <div className={styles.searchBox}><Search size={16} /><input aria-label="搜索统一知识库" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索产品、SKU、资料、聊天或文件…" /></div>
          <input ref={fileRef} aria-label="上传知识文件" type="file" multiple hidden onChange={(event) => void uploadFiles(event.target.files)} />
          <button className={styles.secondaryButton} onClick={() => void loadKnowledge()} disabled={loading || uploading}><RefreshCw size={15} /> 刷新</button>
          <button className={styles.primaryButton} onClick={() => fileRef.current?.click()} disabled={uploading}><Upload size={16} /> {uploading ? "上传并分类中…" : "上传任何文件"}</button>
        </div>
        <div className={styles.categoryTabs} role="tablist" aria-label="统一知识分类筛选">{categories.map((item) => <button role="tab" aria-selected={category === item} className={category === item ? styles.activeTab : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>
      </section>
      <section className={styles.catalogPanel} aria-label="统一产品与资料目录">
        <div className={styles.sectionHead}><div><span>STRUCTURED CATALOG</span><h3>产品档案与关联资料</h3></div><div className={styles.catalogHeadActions}><span className={styles.sourceBadge}>{catalogProducts.length} 个产品 · {assets.length} 份资料</span><button className={styles.secondaryButton} onClick={() => setCreatingProduct(true)}><Plus size={14} /> 新增产品档案</button></div></div>
        <p className={styles.catalogHint}>原“产品中心”和“资料中心”已合并到这里。结构化字段来自后端，上传文件进入下方本地知识库；两者在 Chat-AI 和复盘 Agent 中统一使用。</p>
        <div className={styles.catalogColumns}>
          <div className={styles.productKnowledgeList}>
            <strong>产品档案 · {visibleProducts.length}</strong>
            {visibleProducts.length ? visibleProducts.map((product) => <button key={product.id} className={styles.productKnowledgeRow} onClick={() => onOpenProduct?.(product)} disabled={!onOpenProduct}>
              <span style={{ background: product.gradient }}>{product.model}</span>
              <span><strong>{product.name}</strong><small>{product.sku} · {product.power} · {product.material} · 库存 {product.stock}</small></span>
              <em>{product.status}</em><ChevronRight size={15} />
            </button>) : <div className={styles.catalogEmpty}>当前筛选下没有产品档案</div>}
          </div>
          <div className={styles.assetKnowledgeList}>
            <strong>关联资料 · {visibleAssets.length}</strong>
            {visibleAssets.length ? visibleAssets.map((asset) => <div key={asset.id} className={styles.assetKnowledgeRow}>
              <span><CatalogFileIcon asset={asset} /></span>
              <span><strong>{asset.name}</strong><small>{asset.productName} · {asset.size} · {asset.version ?? "v1.0"}</small></span>
              <em>{assetCategory(asset.type)}</em>
            </div>) : <div className={styles.catalogEmpty}>当前筛选下没有关联资料</div>}
          </div>
        </div>
      </section>
      <section className={styles.metricGrid} aria-label="知识库真实统计">
        <Metric icon={FolderOpen} label="本地上传文件" value={String(summary.total)} detail={`${formatBytes(summary.storageBytes)} / ${formatBytes(summary.storageLimitBytes)}`} />
        <Metric icon={CheckCircle2} label="已分类文件" value={String(summary.classified)} detail="人工确认后可被智能搜索引用" />
        <Metric icon={LoaderCircle} label="待分类" value={String(summary.pending)} detail="模型失败也会保留原件" />
        <Metric icon={Archive} label="仅归档" value={String(summary.archived)} detail="当前版本未理解正文" />
      </section>

      <section className={styles.visualPanel} aria-label="知识分类可视化">
        <div className={styles.sectionHead}><div><span>真实上传数据</span><h3>分类分布</h3></div><span className={styles.sourceBadge}>不含演示知识</span></div>
        {summary.total === 0 ? <div className={styles.chartEmpty}><BarChart3 size={22} /><span>上传文件后，这里会按实际分类结果生成图表。</span></div> : <div className={styles.barChart}>{categories.slice(1).map((item) => { const count = summary.byCategory.find((row) => row.category === item)?.count ?? 0; return <div key={item} className={styles.barRow}><span>{item}</span><div><i style={{ width: `${Math.round((count / maxCategoryCount) * 100)}%` }} /></div><strong>{count}</strong></div>; })}</div>}
      </section>

      <section className={styles.browserPanel}>
        <div className={styles.sectionHead}><div><span>UPLOADED FILES</span><h3>本地上传文件</h3></div><span className={styles.sourceBadge}>{visibleEntries.length} 个结果</span></div>
        {error && <div className={styles.errorBox} role="alert"><CircleAlert size={16} /> {error}<button onClick={() => void loadKnowledge()}>重试</button></div>}
        <div className={styles.browserGrid}>
          <div className={styles.entryList}>
            <div className={styles.listHeading}><span>真实上传 · {visibleEntries.length} 个文件</span><small>只展示后端返回的文件</small></div>
            {loading ? <div className={styles.emptyState}><LoaderCircle className={styles.spin} size={23} /><span>正在读取本地知识库…</span></div> : visibleEntries.length ? visibleEntries.map((entry) => <KnowledgeRow key={entry.id} entry={entry} selected={entry.id === selected?.id} onSelect={() => setSelectedId(entry.id)} />) : <div className={styles.emptyState}><FolderOpen size={23} /><strong>还没有真实上传文件</strong><span>可以上传 PDF、Excel、Word、图片、视频或任意其他文件。</span></div>}
          </div>
          <KnowledgeDetail key={selected?.id ?? "empty"} entry={selected} retryingId={retryingId} onRetry={(entry) => void retryClassification(entry)} onConfirm={(entry, next) => void confirmClassification(entry, next)} />
        </div>
      </section>

      <section className={styles.demoPanel}>
        <div className={styles.sectionHead}><div><span>JSON seed</span><h3>演示知识（不等于上传文件）</h3></div><span className={styles.demoBadge}>{demoEntries.length} 条演示</span></div>
        <p>这些条目来自项目初始 JSON 数据，只用于展示旧数据迁移前的内容；不会计入上方上传统计，也不会自动混入新文件分类结果。</p>
        <DemoKnowledgeList entries={demoEntries} />
      </section>
      {creatingProduct && <ProductKnowledgeForm dataSource={dataSource} onClose={() => setCreatingProduct(false)} onCreated={(product) => { setCatalogProducts((current) => [product, ...current]); setCreatingProduct(false); setCategory("产品档案"); setQuery(product.model); onToast(dataSource === "postgres" ? `${product.model} 已写入 PostgreSQL 并加入知识库` : `${product.model} 已加入当前知识库视图；JSON 种子未被修改`); }} />}
    </div>
  );
}

function ProductKnowledgeForm({ dataSource, onClose, onCreated }: { dataSource: DataSourceKind; onClose: () => void; onCreated: (product: Product) => void }) {
  const [form, setForm] = useState({ name: "", model: "", sku: "", category: "轨道灯", power: "18W", material: "压铸铝", dimensions: "", stock: "0", price: "299" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stock = Math.max(0, Number(form.stock) || 0);
    const price = Math.max(0, Number(form.price) || 0);
    const draft: Product = {
      id: `custom-${Date.now()}`, name: form.name.trim(), model: form.model.trim().toUpperCase(), sku: form.sku.trim().toUpperCase(), category: form.category, family: "自定义产品",
      status: stock > 10 ? "在售" : stock > 0 ? "低库存" : "预售", power: form.power, lumens: "待补充", colorTemp: "待补充", material: form.material,
      dimensions: form.dimensions || "待补充", colors: ["待补充"], scenarios: ["待补充"], supplier: "待补充", cost: 0, priceRange: `¥${price}`, moq: 1, stock,
      leadTime: stock > 0 ? "现货，交期待确认" : "待确认到仓时间", warranty: "待补充", description: "新建产品档案，等待补齐并审核参数。",
      gradient: "linear-gradient(145deg,#dfe5df,#81968a)", accent: "#a8c2b2", assets: [],
    };
    if (!draft.name || !draft.model || !draft.sku) return;
    setSaving(true); setError("");
    try {
      if (dataSource === "postgres") {
        const { id: _temporaryId, ...input } = draft;
        void _temporaryId;
        onCreated(await createProductViaApi(input));
      } else {
        onCreated(draft);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存产品失败");
    } finally {
      setSaving(false);
    }
  }
  return <div className={styles.modalLayer} role="dialog" aria-modal="true" aria-label="新增产品档案"><button className={styles.modalScrim} onClick={onClose} aria-label="关闭新增产品" /><form className={styles.productForm} onSubmit={submit}><div className={styles.productFormHead}><div><span>统一知识库</span><h3>新增产品档案</h3></div><button type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button></div><div className={styles.formGrid}><label>产品名称<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>型号<input required value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} /></label><label>SKU<input required value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} /></label><label>品类<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label><label>功率<input value={form.power} onChange={(event) => setForm({ ...form, power: event.target.value })} /></label><label>材质<input value={form.material} onChange={(event) => setForm({ ...form, material: event.target.value })} /></label><label>尺寸<input value={form.dimensions} onChange={(event) => setForm({ ...form, dimensions: event.target.value })} /></label><label>库存<input type="number" min="0" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} /></label><label>参考价格<input type="number" min="0" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label></div>{error && <p className={styles.formError}>{error}</p>}<div className={styles.productFormActions}><button type="button" className={styles.secondaryButton} onClick={onClose}>取消</button><button className={styles.primaryButton} disabled={saving}>{saving ? "保存中…" : "保存产品档案"}</button></div></form></div>;
}

function emptySummary() {
  return { total: 0, classified: 0, pending: 0, archived: 0, byCategory: [] as Array<{ category: KnowledgeCategory; count: number }>, storageBytes: 0, storageLimitBytes: 2 * 1024 * 1024 * 1024, fileLimit: 500 };
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof FolderOpen; label: string; value: string; detail: string }) {
  return <div className={styles.metric}><span><Icon size={18} /></span><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div></div>;
}

function KnowledgeRow({ entry, selected, onSelect }: { entry: KnowledgeEntry; selected: boolean; onSelect: () => void }) {
  return <button className={`${styles.entryRow} ${selected ? styles.selectedRow : ""}`} onClick={onSelect}><span className={styles.fileIcon}><FileTypeIcon entry={entry} /></span><span className={styles.entryCopy}><strong>{entry.title}</strong><small>{entry.originalName} · {entry.sizeLabel}</small><span><i className={entry.classificationStatus === "pending" ? styles.pending : entry.classificationStatus === "archived" ? styles.archived : styles.ready}>{statusLabel(entry)}</i>{entry.category && <b>{entry.category}</b>}</span></span><ChevronRight size={16} /></button>;
}

function KnowledgeDetail({ entry, retryingId, onRetry, onConfirm }: { entry?: KnowledgeEntry; retryingId?: string; onRetry: (entry: KnowledgeEntry) => void; onConfirm: (entry: KnowledgeEntry, category: string) => void }) {
  const [category, setCategory] = useState(entry?.category ?? "");
  if (!entry) return <aside className={styles.detail}><div className={styles.emptyState}><FileText size={24} /><strong>选择一个文件</strong><span>查看分类、解析状态和可读正文预览。</span></div></aside>;
  const canRetry = entry.source === "uploaded" && entry.hasText && (entry.classificationStatus !== "classified" || Boolean(entry.classificationError));
  return <aside className={styles.detail} aria-label="知识文件详情"><div className={styles.detailTop}><span className={styles.detailType}>{entry.source === "demo" ? "演示知识" : entry.extension || "未知格式"}</span><span className={entry.classificationStatus === "archived" ? styles.archived : entry.classificationStatus === "pending" ? styles.pending : styles.ready}>{statusLabel(entry)}</span></div><h3>{entry.title}</h3><p className={styles.detailName}>{entry.originalName} · {entry.sizeLabel} · v{entry.version.replace(/^v/, "")}</p><p className={styles.detailSummary}>{entry.summary}</p>{entry.parseStatus !== "parsed" ? <div className={styles.archiveNotice}><Archive size={17} /><div><strong>仅归档未理解</strong><span>{entry.parseError || "当前版本未提取可读正文；不会把文件名当成已理解内容。"}</span></div></div> : <div className={styles.textPreview}><div><span>已提取正文预览</span>{entry.truncated && <em>正文超过 20,000 字符，已截断给模型</em>}</div><p>{entry.textPreview || "解析结果没有可展示的正文。"}</p></div>}<div className={styles.detailMeta}><span><small>分类来源</small><strong>{entry.classificationSource === "model" ? `模型自评 ${entry.confidence === null ? "—" : `${Math.round(entry.confidence * 100)}%`}` : entry.classificationSource === "manual" ? "人工确认" : "无"}</strong></span><span><small>正文字符</small><strong>{entry.characters.toLocaleString()}</strong></span><span><small>分类输入</small><strong>{entry.classificationCharacters.toLocaleString()} 字符</strong></span><span><small>标签</small><strong>{entry.tags.join("、") || "—"}</strong></span><span><small>SHA-256</small><strong>{entry.sha256Prefix}…</strong></span></div>{entry.source === "uploaded" && <div className={styles.detailActions}><a className={styles.secondaryButton} href={entry.downloadUrl}><Download size={15} /> 下载原件</a>{canRetry && <button className={styles.secondaryButton} disabled={retryingId === entry.id} onClick={() => onRetry(entry)}>{retryingId === entry.id ? <LoaderCircle className={styles.spin} size={15} /> : <RefreshCw size={15} />} 重试分类</button>}</div>}{entry.source === "uploaded" && entry.hasText && entry.classificationSource !== "manual" && <div className={styles.confirmBox}><label>人工确认分类<select aria-label="人工确认知识分类" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">选择分类…</option>{categories.slice(1).map((item) => <option key={item} value={item}>{item}</option>)}</select></label><button className={styles.primaryButton} disabled={!category} onClick={() => onConfirm(entry, category)}><ShieldCheck size={15} /> 确认并纳入检索</button></div>}<p className={styles.detailFootnote}><ShieldCheck size={13} /> 新上传文件默认不进入智能搜索；人工确认分类后才会被销售角色引用。模型置信度只是模型自评，不是准确率保证；客户聊天记录请先确认隐私与权限。</p></aside>;
}

function FileTypeIcon({ entry }: { entry: KnowledgeEntry }) {
  if (entry.mimeType.startsWith("image/")) return <FileImage size={18} />;
  if (["xlsx", "csv", "tsv"].includes(entry.extension)) return <FileSpreadsheet size={18} />;
  if (["zip", "rar", "7z"].includes(entry.extension)) return <FileArchive size={18} />;
  if (entry.hasText) return <FileText size={18} />;
  return <File size={18} />;
}

function CatalogFileIcon({ asset }: { asset: Asset }) {
  if (asset.type === "图片" || asset.type === "尺寸图") return <FileImage size={16} />;
  if (asset.type === "参数表") return <FileSpreadsheet size={16} />;
  if (asset.type === "PDF") return <FileText size={16} />;
  if (asset.type === "视频") return <File size={16} />;
  return <FileArchive size={16} />;
}

function DemoKnowledgeList({ entries }: { entries: DemoViewEntry[] }) {
  const [openId, setOpenId] = useState<string>();
  return <div className={styles.demoList}>{entries.map((entry) => <article className={styles.demoArticle} key={entry.id}><button onClick={() => setOpenId((current) => current === entry.id ? undefined : entry.id)}><span><Tag size={12} /> {entry.title}</span><ChevronRight size={14} className={openId === entry.id ? styles.demoChevronOpen : ""} /></button>{openId === entry.id && <p>{entry.demoContent}</p>}</article>)}</div>;
}
