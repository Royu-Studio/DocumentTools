<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { createWorker } from "tesseract.js";
import { saveAs } from "file-saver";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { useWorkspaceStore } from "@/stores/workspace.js";
import { safeDownloadName, validateFile } from "@/utils/files.js";

import { configurePdfJsWorker } from "@/utils/pdfWorker.js";
import { binarizePixels } from "@/utils/ocrPixels.js";

configurePdfJsWorker(pdfjsLib);

const props = defineProps({ embedded: Boolean, active: { type: Boolean, default: true } });
const languageOptions = [
  { value: "chi_sim+eng", label: "中文简体 + English" },
  { value: "eng", label: "English" },
  { value: "chi_sim", label: "中文简体" }
];

const ocrAssetsBase = "/ocr-assets";
const EMPTY_RESULT_TEXT = "识别文本会显示在这里";

const selectedFile = ref(null);
const selectedLanguage = ref("chi_sim+eng");
const statusText = ref("请选择文件");
const resultText = ref(EMPTY_RESULT_TEXT);
const isBusy = ref(false);
const previewType = ref("empty");
const previewPages = ref([]);
const currentPreviewPage = ref(0);
const selection = ref(null);
const dragSelection = ref(null);
const imagePreviewUrl = ref("");
const pdfPreviewUrls = ref([]);
const previewImageEl = ref(null);
const workspace = useWorkspaceStore();
const activeWorker = ref(null);
const destroyed = ref(false);

const fileMeta = computed(() => {
  if (!selectedFile.value) {
    return "尚未选择文件";
  }

  return `${selectedFile.value.name} · ${formatFileSize(selectedFile.value.size)}`;
});

const currentPreview = computed(() => previewPages.value[currentPreviewPage.value] ?? null);

const selectionBoxStyle = computed(() => {
  const page = currentPreview.value;
  const imageEl = previewImageEl.value;
  const rect = getActiveSelection();
  if (!page || !imageEl || !rect) {
    return null;
  }

  const scaleX = imageEl.clientWidth / page.width;
  const scaleY = imageEl.clientHeight / page.height;

  return {
    left: `${rect.left * scaleX}px`,
    top: `${rect.top * scaleY}px`,
    width: `${rect.width * scaleX}px`,
    height: `${rect.height * scaleY}px`
  };
});

async function handleFileChange(event) {
  const [file] = event.target.files ?? [];
  event.target.value = "";
  await loadSelectedFile(file);
}

async function loadSelectedFile(file) {
  const validation = validateFile(file, { allow: ["pdf", "image"] });
  if (file && !validation.valid) {
    statusText.value = "文件不受支持";
    resultText.value = validation.message;
    return;
  }
  const supportedImage = !file || isPdfFile(file) || ["image/png", "image/jpeg", "image/webp"].includes(file.type);
  if (!supportedImage) {
    statusText.value = "文件不受支持";
    resultText.value = "OCR 支持 PNG、JPG、WEBP 或 PDF 文件。";
    return;
  }
  cleanupPreview();

  selectedFile.value = file ?? null;
  resultText.value = EMPTY_RESULT_TEXT;
  currentPreviewPage.value = 0;
  clearSelection();

  if (!selectedFile.value) {
    previewType.value = "empty";
    statusText.value = "请选择文件";
    return;
  }

  statusText.value = "文件已加载，正在准备预览";

  if (isPdfFile(selectedFile.value)) {
    previewType.value = "pdf-loading";
  }

  try {
    const pages = await buildPreviewPages(selectedFile.value);
    if (destroyed.value) return;
    previewPages.value = pages;

    if (pages.length === 0) {
      previewType.value = "empty";
      statusText.value = "未能生成预览";
      return;
    }

    previewType.value = selectedFile.value && isPdfFile(selectedFile.value) ? "pdf" : "image";
    statusText.value = "文件已加载，等待识别";
    workspace.setCurrentFileName(selectedFile.value.name);
  } catch (error) {
    console.error("OCR 预览生成失败", error);
    previewType.value = "empty";
    statusText.value = "预览生成失败";
    resultText.value = `无法读取文件：${error.message}`;
  }
}

async function recognizeFile() {
  if (previewPages.value.length === 0 || isBusy.value) {
    return;
  }

  isBusy.value = true;
  statusText.value = "正在准备文字识别...";
  resultText.value = "";

  let worker = null;

  try {
    worker = await createOcrWorker();
    activeWorker.value = worker;

    const outputs = [];
    for (let index = 0; index < previewPages.value.length; index += 1) {
      const pageLabel = `第 ${index + 1}/${previewPages.value.length} 页`;
      statusText.value = `正在预处理${pageLabel}...`;
      const bestData = await recognizeBestVariant(worker, previewPages.value[index].canvas, pageLabel);
      outputs.push(formatPageResult(index + 1, buildStructuredText(bestData, previewPages.value[index].canvas)));
    }

    resultText.value = outputs.join("\n\n");
    statusText.value = `识别完成，共 ${previewPages.value.length} 页`;
  } catch (error) {
    console.error(error);
    statusText.value = "识别失败";
    resultText.value = `发生错误：${error.message}`;
  } finally {
    if (worker) {
      await worker.terminate();
    }
    activeWorker.value = null;

    isBusy.value = false;
  }
}

async function recognizeSelection() {
  const page = currentPreview.value;
  const rect = getStoredSelectionForCurrentPage();
  if (!page || !rect || isBusy.value) {
    return;
  }

  isBusy.value = true;
  statusText.value = `正在识别框选区域（第 ${currentPreviewPage.value + 1} 页）...`;

  let worker = null;

  try {
    const croppedCanvas = cropCanvas(page.canvas, rect);
    worker = await createOcrWorker();
    activeWorker.value = worker;
    const bestData = await recognizeBestVariant(worker, croppedCanvas, `第 ${currentPreviewPage.value + 1} 页框选区域`);
    const manualText = formatManualSelectionResult(currentPreviewPage.value + 1, buildStructuredText(bestData, croppedCanvas));

    resultText.value = resultText.value && resultText.value !== EMPTY_RESULT_TEXT
      ? `${resultText.value}\n\n${manualText}`
      : manualText;
    statusText.value = `框选识别完成（第 ${currentPreviewPage.value + 1} 页）`;
  } catch (error) {
    console.error(error);
    statusText.value = "框选识别失败";
    resultText.value = `发生错误：${error.message}`;
  } finally {
    if (worker) {
      await worker.terminate();
    }
    activeWorker.value = null;

    isBusy.value = false;
  }
}

async function createOcrWorker() {
  const worker = await createWorker(selectedLanguage.value, 1, {
    workerPath: `${ocrAssetsBase}/worker.min.js`,
    corePath: `${ocrAssetsBase}/core`,
    langPath: `${ocrAssetsBase}/lang-data`,
    gzip: true,
    logger: (message) => {
      if (message.status === "recognizing text") {
        statusText.value = `正在识别：${Math.round(message.progress * 100)}%`;
      }
    }
  });

  await worker.setParameters({
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: "3",
    user_defined_dpi: "300"
  });

  return worker;
}

async function recognizeBestVariant(worker, sourceCanvas, pageLabel) {
  const primaryCanvas = preprocessCanvasForOcr(sourceCanvas, false);
  statusText.value = `正在识别${pageLabel}...`;
  const primaryResult = await worker.recognize(primaryCanvas);
  let bestData = primaryResult.data;

  if (shouldRetryWithInversion(primaryResult.data, sourceCanvas)) {
    const invertedCanvas = preprocessCanvasForOcr(sourceCanvas, true);
    statusText.value = `正在增强识别${pageLabel}...`;
    const invertedResult = await worker.recognize(invertedCanvas);
    bestData = pickBetterResult(primaryResult.data, invertedResult.data);
  }

  return bestData;
}

function shouldRetryWithInversion(data, sourceCanvas) {
  const confidence = data?.confidence ?? 0;
  return confidence < 58 || estimateCanvasBrightness(sourceCanvas) < 145;
}

function pickBetterResult(primary, secondary) {
  const primaryScore = scoreOcrResult(primary);
  const secondaryScore = scoreOcrResult(secondary);
  return secondaryScore > primaryScore ? secondary : primary;
}

function scoreOcrResult(data) {
  const confidence = data?.confidence ?? 0;
  const textLength = normalizeInlineText(data?.text).length;
  return confidence * 2 + Math.min(textLength, 400) * 0.08;
}

async function buildPreviewPages(file) {
  if (isPdfFile(file)) {
    const canvases = await extractPdfPages(file);
    return canvases.map((canvas, index) => createPreviewPage(canvas, index));
  }

  const canvas = await imageFileToCanvas(file);
  return [createPreviewPage(canvas, 0)];
}

function createPreviewPage(canvas, index) {
  const url = canvas.toDataURL("image/png");
  return {
    id: `page-${index}`,
    index,
    url,
    canvas,
    width: canvas.width,
    height: canvas.height
  };
}

async function imageFileToCanvas(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("无法创建图片 OCR 画布");
  }

  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return canvas;
}

async function extractPdfPages(file) {
  const pdf = await loadPdfDocument(file);
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("无法创建 PDF OCR 画布");
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: context, viewport }).promise;
    pages.push(canvas);
  }

  return pages;
}

async function loadPdfDocument(file) {
  const buffer = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: buffer }).promise;
}

function startSelection(event) {
  if (!selectionMode.value || !currentPreview.value || isBusy.value) {
    return;
  }

  const point = getPointOnPreview(event);
  if (!point) {
    return;
  }

  dragSelection.value = {
    pageIndex: currentPreviewPage.value,
    startX: point.x,
    startY: point.y,
    endX: point.x,
    endY: point.y
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

const selectionMode = ref(false);

function updateSelection(event) {
  if (!dragSelection.value) {
    return;
  }

  const point = getPointOnPreview(event);
  if (!point) {
    return;
  }

  dragSelection.value = {
    ...dragSelection.value,
    endX: point.x,
    endY: point.y
  };
}

function finishSelection() {
  if (!dragSelection.value) {
    return;
  }

  const normalized = normalizeRect(
    dragSelection.value.startX,
    dragSelection.value.startY,
    dragSelection.value.endX,
    dragSelection.value.endY
  );

  dragSelection.value = null;
  if (normalized.width < 12 || normalized.height < 12) {
    clearSelection();
    return;
  }

  selection.value = {
    pageIndex: currentPreviewPage.value,
    ...normalized
  };
}

function cancelSelection() {
  dragSelection.value = null;
}

function clearSelection() {
  selection.value = null;
  dragSelection.value = null;
}

function switchPreviewPage(index) {
  currentPreviewPage.value = index;
  dragSelection.value = null;
}

function getPointOnPreview(event) {
  const imageEl = previewImageEl.value;
  const page = currentPreview.value;
  if (!imageEl || !page) {
    return null;
  }

  const bounds = imageEl.getBoundingClientRect();
  const clientX = event.clientX;
  const clientY = event.clientY;
  if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) {
    return null;
  }

  const scaleX = page.width / bounds.width;
  const scaleY = page.height / bounds.height;
  return {
    x: clamp(Math.round((clientX - bounds.left) * scaleX), 0, page.width),
    y: clamp(Math.round((clientY - bounds.top) * scaleY), 0, page.height)
  };
}

function getActiveSelection() {
  if (dragSelection.value && dragSelection.value.pageIndex === currentPreviewPage.value) {
    return normalizeRect(
      dragSelection.value.startX,
      dragSelection.value.startY,
      dragSelection.value.endX,
      dragSelection.value.endY
    );
  }

  return getStoredSelectionForCurrentPage();
}

function getStoredSelectionForCurrentPage() {
  if (!selection.value || selection.value.pageIndex !== currentPreviewPage.value) {
    return null;
  }

  return selection.value;
}

function normalizeRect(startX, startY, endX, endY) {
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  return { left, top, width, height };
}

function cropCanvas(sourceCanvas, rect) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("无法创建框选识别画布");
  }

  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
  context.drawImage(
    sourceCanvas,
    rect.left,
    rect.top,
    rect.width,
    rect.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return canvas;
}

function preprocessCanvasForOcr(sourceCanvas, invert) {
  const canvas = document.createElement("canvas");
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("无法创建 OCR 预处理画布");
  }

  context.drawImage(sourceCanvas, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  const histogram = new Array(256).fill(0);
  const grayValues = new Uint8Array(canvas.width * canvas.height);

  for (let pixelIndex = 0, grayIndex = 0; pixelIndex < pixels.length; pixelIndex += 4, grayIndex += 1) {
    const red = pixels[pixelIndex];
    const green = pixels[pixelIndex + 1];
    const blue = pixels[pixelIndex + 2];
    const alpha = pixels[pixelIndex + 3] / 255;
    const gray = Math.round((red * 0.299 + green * 0.587 + blue * 0.114) * alpha + 255 * (1 - alpha));
    grayValues[grayIndex] = gray;
    histogram[gray] += 1;
  }

  const threshold = otsuThreshold(histogram, grayValues.length);
  binarizePixels(pixels, threshold, invert);

  context.putImageData(imageData, 0, 0);
  return canvas;
}

function estimateCanvasBrightness(sourceCanvas) {
  const sample = createSampleCanvas(sourceCanvas, 160);
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return 255;
  }

  const { data } = context.getImageData(0, 0, sample.width, sample.height);
  let total = 0;

  for (let index = 0; index < data.length; index += 4) {
    total += data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
  }

  return total / (sample.width * sample.height);
}

function findPercentile(histogram, total, percentile) {
  const target = total * percentile;
  let cumulative = 0;

  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index];
    if (cumulative >= target) {
      return index;
    }
  }

  return histogram.length - 1;
}

function otsuThreshold(histogram, total) {
  let sum = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    sum += index * histogram[index];
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = 0;
  let threshold = 127;

  for (let index = 0; index < histogram.length; index += 1) {
    weightBackground += histogram[index];
    if (weightBackground === 0) {
      continue;
    }

    const weightForeground = total - weightBackground;
    if (weightForeground === 0) {
      break;
    }

    sumBackground += index * histogram[index];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = index;
    }
  }

  return threshold;
}

function buildStructuredText(data, canvas) {
  const groupedByColor = buildColorAwareText(data?.blocks, canvas);
  if (groupedByColor) {
    return groupedByColor;
  }

  const blockText = extractBlockText(data?.blocks);
  if (blockText) {
    return blockText;
  }

  return data?.text?.trim() || "该页未识别到可用文本";
}

function buildColorAwareText(blocks, canvas) {
  if (!Array.isArray(blocks) || blocks.length === 0 || !canvas) {
    return "";
  }

  const colorRegions = detectColorRegions(canvas);
  if (colorRegions.length === 0) {
    return "";
  }

  const regionEntries = colorRegions.map((region) => ({
    top: region.top,
    left: region.left,
    blocks: []
  }));

  const neutralEntry = {
    top: Number.POSITIVE_INFINITY,
    left: Number.POSITIVE_INFINITY,
    blocks: []
  };

  for (const block of blocks) {
    const matchedRegion = findRegionForBlock(block, colorRegions);
    if (matchedRegion >= 0) {
      regionEntries[matchedRegion].blocks.push(block);
      continue;
    }

    neutralEntry.blocks.push(block);
    neutralEntry.top = Math.min(neutralEntry.top, getTop(block));
    neutralEntry.left = Math.min(neutralEntry.left, getLeft(block));
  }

  const orderedEntries = [...regionEntries, neutralEntry]
    .filter((entry) => entry.blocks.length > 0)
    .sort((left, right) => comparePosition(left.top, left.left, right.top, right.left));

  const sections = orderedEntries.map((entry) => extractBlockText(entry.blocks)).filter(Boolean);
  return sections.join("\n\n").trim();
}

function detectColorRegions(sourceCanvas) {
  const sample = createSampleCanvas(sourceCanvas, 240);
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return [];
  }

  const { width, height } = sample;
  const { data } = context.getImageData(0, 0, width, height);
  const totalPixels = width * height;
  const histogram = new Map();

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];

    if (!isColorfulPixel(red, green, blue)) {
      continue;
    }

    const bucket = `${Math.round(red / 24)}-${Math.round(green / 24)}-${Math.round(blue / 24)}`;
    const current = histogram.get(bucket) ?? { count: 0, red: 0, green: 0, blue: 0 };
    current.count += 1;
    current.red += red;
    current.green += green;
    current.blue += blue;
    histogram.set(bucket, current);
  }

  const colorCandidates = [...histogram.values()]
    .map((entry) => ({
      count: entry.count,
      red: entry.red / entry.count,
      green: entry.green / entry.count,
      blue: entry.blue / entry.count
    }))
    .filter((entry) => entry.count / totalPixels >= 0.015)
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);

  const regions = colorCandidates
    .map((candidate) => findColorRegionBounds(data, width, height, candidate))
    .filter(Boolean)
    .map((region) => scaleRegion(region, sourceCanvas.width / width, sourceCanvas.height / height));

  return mergeRegions(regions, sourceCanvas.width, sourceCanvas.height);
}

function createSampleCanvas(sourceCanvas, maxSize) {
  const ratio = Math.min(1, maxSize / Math.max(sourceCanvas.width, sourceCanvas.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceCanvas.width * ratio));
  canvas.height = Math.max(1, Math.round(sourceCanvas.height * ratio));

  const context = canvas.getContext("2d");
  if (context) {
    context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  }

  return canvas;
}

function isColorfulPixel(red, green, blue) {
  const min = Math.min(red, green, blue);
  const max = Math.max(red, green, blue);
  const delta = max - min;
  const average = (red + green + blue) / 3;
  return delta >= 20 && average >= 35 && average <= 245;
}

function findColorRegionBounds(pixelData, width, height, candidate) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let count = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const red = pixelData[index];
      const green = pixelData[index + 1];
      const blue = pixelData[index + 2];

      if (!isCloseColor(red, green, blue, candidate)) {
        continue;
      }

      count += 1;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (count === 0) {
    return null;
  }

  const regionWidth = right - left + 1;
  const regionHeight = bottom - top + 1;
  const coverage = count / (regionWidth * regionHeight);
  const areaRatio = (regionWidth * regionHeight) / (width * height);

  if (regionWidth < width * 0.12 || regionHeight < height * 0.05 || coverage < 0.25 || areaRatio < 0.02) {
    return null;
  }

  return { left, top, right, bottom };
}

function isCloseColor(red, green, blue, candidate) {
  const distance = Math.abs(red - candidate.red) + Math.abs(green - candidate.green) + Math.abs(blue - candidate.blue);
  return distance <= 72;
}

function scaleRegion(region, scaleX, scaleY) {
  return {
    left: Math.round(region.left * scaleX),
    top: Math.round(region.top * scaleY),
    right: Math.round(region.right * scaleX),
    bottom: Math.round(region.bottom * scaleY)
  };
}

function mergeRegions(regions, width, height) {
  const merged = [];

  for (const region of regions) {
    if (!region) {
      continue;
    }

    const existing = merged.find((item) => overlapRatio(item, region) > 0.35 || isNearRegion(item, region, width, height));
    if (existing) {
      existing.left = Math.min(existing.left, region.left);
      existing.top = Math.min(existing.top, region.top);
      existing.right = Math.max(existing.right, region.right);
      existing.bottom = Math.max(existing.bottom, region.bottom);
      continue;
    }

    merged.push({ ...region });
  }

  return merged
    .filter((region) => {
      const regionWidth = region.right - region.left;
      const regionHeight = region.bottom - region.top;
      const areaRatio = (regionWidth * regionHeight) / (width * height);
      return areaRatio < 0.9;
    })
    .sort((left, right) => comparePosition(left.top, left.left, right.top, right.left));
}

function isNearRegion(left, right, width, height) {
  const horizontalGap = Math.max(0, Math.max(left.left, right.left) - Math.min(left.right, right.right));
  const verticalGap = Math.max(0, Math.max(left.top, right.top) - Math.min(left.bottom, right.bottom));
  return horizontalGap < width * 0.04 && verticalGap < height * 0.03;
}

function overlapRatio(left, right) {
  const overlapWidth = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const overlapHeight = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  if (overlapWidth === 0 || overlapHeight === 0) {
    return 0;
  }

  const overlapArea = overlapWidth * overlapHeight;
  const smallerArea = Math.min(
    (left.right - left.left) * (left.bottom - left.top),
    (right.right - right.left) * (right.bottom - right.top)
  );

  return smallerArea > 0 ? overlapArea / smallerArea : 0;
}

function findRegionForBlock(block, regions) {
  const bbox = block?.bbox;
  if (!bbox) {
    return -1;
  }

  const centerX = ((bbox.x0 ?? bbox.left ?? 0) + (bbox.x1 ?? bbox.right ?? 0)) / 2;
  const centerY = ((bbox.y0 ?? bbox.top ?? 0) + (bbox.y1 ?? bbox.bottom ?? 0)) / 2;

  return regions.findIndex((region) => pointInRegion(centerX, centerY, region) || blockOverlapWithRegion(bbox, region) > 0.3);
}

function pointInRegion(x, y, region) {
  return x >= region.left && x <= region.right && y >= region.top && y <= region.bottom;
}

function blockOverlapWithRegion(bbox, region) {
  const box = {
    left: bbox.x0 ?? bbox.left ?? 0,
    top: bbox.y0 ?? bbox.top ?? 0,
    right: bbox.x1 ?? bbox.right ?? 0,
    bottom: bbox.y1 ?? bbox.bottom ?? 0
  };

  return overlapRatio(box, region);
}

function extractBlockText(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return "";
  }

  const sortedBlocks = [...blocks].sort(compareByPosition);
  const blockTexts = sortedBlocks.map((block) => extractParagraphText(block?.paragraphs)).filter(Boolean);
  return blockTexts.join("\n\n").trim();
}

function extractParagraphText(paragraphs) {
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
    return "";
  }

  const sortedParagraphs = [...paragraphs].sort(compareByPosition);
  const paragraphTexts = sortedParagraphs.map((paragraph) => extractLineText(paragraph?.lines)).filter(Boolean);
  return paragraphTexts.join("\n\n").trim();
}

function extractLineText(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return "";
  }

  const sortedLines = [...lines].sort(compareByPosition);
  const lineTexts = sortedLines
    .map((line) => {
      const text = normalizeInlineText(line?.text);
      if (text) {
        return text;
      }

      const words = Array.isArray(line?.words) ? line.words : [];
      return words
        .sort(compareByPosition)
        .map((word) => normalizeInlineText(word?.text))
        .filter(Boolean)
        .join(" ");
    })
    .filter(Boolean);

  return lineTexts.join("\n").trim();
}

function normalizeInlineText(text) {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
}

function compareByPosition(left, right) {
  return comparePosition(getTop(left), getLeft(left), getTop(right), getLeft(right));
}

function comparePosition(topA, leftA, topB, leftB) {
  const topGap = topA - topB;
  if (Math.abs(topGap) > 12) {
    return topGap;
  }

  return leftA - leftB;
}

function getTop(item) {
  return item?.bbox?.y0 ?? item?.bbox?.top ?? item?.top ?? 0;
}

function getLeft(item) {
  return item?.bbox?.x0 ?? item?.bbox?.left ?? item?.left ?? 0;
}

function formatPageResult(pageNumber, text) {
  const cleanedText = text.trim() || "该页未识别到可用文本";
  return `===== 第 ${pageNumber} 页 =====\n${cleanedText}`;
}

function formatManualSelectionResult(pageNumber, text) {
  const cleanedText = text.trim() || "该区域未识别到可用文本";
  return `===== 框选识别 第 ${pageNumber} 页 =====\n${cleanedText}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function cleanupPreview() {
  if (imagePreviewUrl.value) {
    URL.revokeObjectURL(imagePreviewUrl.value);
    imagePreviewUrl.value = "";
  }

  for (const page of previewPages.value) {
    if (page?.url) {
      URL.revokeObjectURL?.(page.url);
    }
  }

  pdfPreviewUrls.value = [];
  previewPages.value = [];
}

async function copyResult() {
  if (!resultText.value || resultText.value === EMPTY_RESULT_TEXT) return;
  try {
    await navigator.clipboard.writeText(resultText.value);
    statusText.value = "识别结果已复制";
  } catch {
    statusText.value = "复制失败，请手动选择文本";
  }
}

function downloadResult() {
  if (!resultText.value || resultText.value === EMPTY_RESULT_TEXT) return;
  saveAs(new Blob([resultText.value], { type: "text/plain;charset=utf-8" }), safeDownloadName(selectedFile.value?.name, "识别结果", "txt"));
  statusText.value = "识别结果已下载";
}

function handlePaste(event) {
  if (!props.active || props.embedded) return;
  const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith("image/"));
  if (file && !isBusy.value) loadSelectedFile(file);
}

function isPdfFile(file) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

onMounted(async () => {
  window.addEventListener("paste", handlePaste);
  const staged = workspace.takeFile("ocr");
  if (staged) await loadSelectedFile(staged);
});

onBeforeUnmount(() => {
  destroyed.value = true;
  window.removeEventListener("paste", handlePaste);
  activeWorker.value?.terminate?.();
  activeWorker.value = null;
  cleanupPreview();
  workspace.setCurrentFileName("");
});
defineExpose({ load: async file => { await loadSelectedFile(file); if (!previewPages.value.length) throw new Error(statusText.value); }, isBusy });
</script>

<template>
  <main class="layout">
    <section class="hero">
      <div v-if="!embedded" class="hero-copy">
        <p class="eyebrow">离线文字识别</p>
        <h1>识别图片和 PDF 中的文字</h1>
        <p class="hero-text">
          支持整页识别，也可框选区域提取文字。
        </p>
      </div>

      <div class="hero-panel">
        <label v-if="!embedded" class="upload-card">
          <input type="file" accept="image/*,.pdf,application/pdf" @change="handleFileChange" />
          <span class="upload-title">选择文件</span>
          <span class="upload-subtitle">支持 PNG、JPG、WEBP、PDF</span>
        </label>

        <div class="controls controls-stack">
          <label class="field">
            <span>识别语言</span>
            <select v-model="selectedLanguage">
              <option v-for="option in languageOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>

          <div class="action-row">
            <button class="primary-btn" :disabled="previewPages.length === 0 || isBusy" @click="recognizeFile">
              {{ isBusy ? "识别中..." : "整页识别" }}
            </button>
            <button class="secondary-btn" :disabled="!getStoredSelectionForCurrentPage() || isBusy" @click="recognizeSelection">
              框选识别
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="workspace">
      <div class="panel">
        <div class="panel-header">
          <h2>预览</h2>
          <span class="meta">{{ fileMeta }}</span>
        </div>

        <div v-if="previewType === 'empty'" class="preview empty">选择文件后显示预览</div>
        <div v-else-if="previewType === 'pdf-loading'" class="preview empty">PDF 正在生成预览...</div>
        <div v-else class="preview preview-shell">
          <div v-if="previewPages.length > 1" class="page-tabs">
            <button
              v-for="page in previewPages"
              :key="page.id"
              class="page-tab"
              :class="{ active: currentPreviewPage === page.index }"
              @click="switchPreviewPage(page.index)"
            >
              第 {{ page.index + 1 }} 页
            </button>
          </div>

          <div class="selection-hint">
            <button class="link-btn" :aria-pressed="selectionMode" :disabled="isBusy" @click="selectionMode = !selectionMode; cancelSelection()">{{ selectionMode ? '完成框选' : '框选区域' }}</button>
            <span>{{ selectionMode ? '拖动选择区域' : '可滚动浏览预览' }}</span>
            <button class="link-btn" :disabled="!getStoredSelectionForCurrentPage() && !dragSelection" @click="clearSelection">
              清除框选
            </button>
          </div>

          <div
            class="preview-stage"
            :class="{ 'selection-mode': selectionMode }"
            @pointerdown="startSelection"
            @pointermove="updateSelection"
            @pointerup="finishSelection"
            @pointercancel="cancelSelection"
          >
            <img
              v-if="currentPreview"
              ref="previewImageEl"
              :src="currentPreview.url"
              :alt="`第 ${currentPreviewPage + 1} 页预览`"
              class="preview-image"
              draggable="false"
            />
            <div v-if="selectionBoxStyle" class="selection-box" :style="selectionBoxStyle"></div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2>识别结果</h2>
          <div class="result-actions">
            <span class="meta">{{ statusText }}</span>
            <button class="link-btn" :disabled="isBusy || !resultText || resultText === EMPTY_RESULT_TEXT" @click="copyResult">复制</button>
            <button class="link-btn" :disabled="isBusy || !resultText || resultText === EMPTY_RESULT_TEXT" @click="downloadResult">下载 TXT</button>
          </div>
        </div>

        <div class="result" :class="{ empty: resultText === EMPTY_RESULT_TEXT }">
          {{ resultText }}
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
:root {
  color-scheme: light;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color: #172033;
  background:
    radial-gradient(circle at top, rgba(240, 179, 73, 0.35), transparent 28%),
    linear-gradient(135deg, #f6f2e8 0%, #eef3ff 55%, #dfe8ff 100%);
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  --panel-bg: rgba(255, 255, 255, 0.76);
  --panel-border: rgba(23, 32, 51, 0.08);
  --shadow: 0 20px 60px rgba(39, 58, 93, 0.12);
  --accent: #cc5f2d;
  --accent-dark: #9f451c;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}

button,
input,
select {
  font: inherit;
}

.layout {
  width: min(1180px, calc(100% - 32px));
  margin: 0 auto;
  padding: 32px 0 56px;
}

.result-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }

/* Shared Material 3 application tokens override the former standalone theme. */
.layout { color: var(--md-on-surface); background: var(--md-surface); }
.hero-copy, .hero-panel, .panel { background: var(--md-surface-container); border-color: var(--md-outline-variant); box-shadow: var(--md-shadow); border-radius: var(--radius-md); backdrop-filter: none; }
.hero-text, .meta, .field span, .selection-hint { color: var(--md-on-surface-variant); }
.upload-card { border-color: var(--md-outline); background: var(--md-surface-container-high); border-radius: var(--radius-md); }
.preview, .result { color: var(--md-on-surface); background: var(--md-surface); border-color: var(--md-outline-variant); border-radius: var(--radius-sm); }
.primary-btn { background: var(--md-primary); color: var(--md-on-primary); }
.secondary-btn, select, .page-tab { color: var(--md-on-surface); background: var(--md-surface); border-color: var(--md-outline-variant); }
.page-tab.active { color: var(--md-on-primary); background: var(--md-primary); }
.link-btn, .eyebrow { color: var(--md-primary); }
.selection-box { border-color: var(--md-primary); background: color-mix(in srgb, var(--md-primary) 14%, transparent); }

.hero {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 24px;
  align-items: stretch;
  margin-bottom: 24px;
}

.hero-copy,
.hero-panel,
.panel {
  background: var(--panel-bg);
  backdrop-filter: blur(18px);
  border: 1px solid var(--panel-border);
  box-shadow: var(--shadow);
  border-radius: 28px;
}

.hero-copy {
  padding: 36px;
}

.eyebrow {
  margin: 0 0 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
  font-size: 0.9rem;
  font-weight: 700;
}

h1,
h2 {
  margin: 0;
}

h1 {
  font-size: clamp(2.2rem, 5vw, 4.4rem);
  line-height: 0.96;
  letter-spacing: -0.05em;
}

.hero-text {
  margin: 20px 0 0;
  max-width: 54ch;
  font-size: 1.05rem;
  color: rgba(23, 32, 51, 0.8);
}

.hero-panel {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.upload-card {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 6px;
  justify-content: center;
  min-height: 220px;
  padding: 28px;
  border-radius: 24px;
  border: 2px dashed rgba(204, 95, 45, 0.38);
  background:
    linear-gradient(160deg, rgba(255, 255, 255, 0.74), rgba(248, 238, 221, 0.92)),
    linear-gradient(120deg, rgba(204, 95, 45, 0.08), rgba(108, 131, 255, 0.12));
  cursor: pointer;
}

.upload-card input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.upload-title {
  font-size: 1.35rem;
  font-weight: 700;
}

.upload-subtitle {
  color: rgba(23, 32, 51, 0.66);
}

.controls {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16px;
  align-items: end;
}

.controls-stack {
  grid-template-columns: 1fr;
}

.action-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.field {
  display: grid;
  gap: 8px;
}

.field span {
  font-size: 0.92rem;
  color: rgba(23, 32, 51, 0.7);
}

select,
.primary-btn,
.secondary-btn {
  min-height: 48px;
  border-radius: 14px;
  border: 1px solid rgba(23, 32, 51, 0.12);
  padding: 0 16px;
}

.primary-btn,
.secondary-btn,
.page-tab,
.link-btn {
  cursor: pointer;
}

.primary-btn {
  border: 0;
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-dark) 100%);
  color: white;
  font-weight: 700;
  padding: 0 24px;
}

.secondary-btn {
  background: rgba(255, 255, 255, 0.86);
  color: #172033;
  font-weight: 600;
}

.primary-btn:disabled,
.secondary-btn:disabled,
.link-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.workspace {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.panel {
  padding: 24px;
  min-height: 520px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}

.meta {
  color: rgba(23, 32, 51, 0.62);
  font-size: 0.92rem;
}

.preview,
.result {
  min-height: 430px;
  border-radius: 20px;
  padding: 18px;
  background: rgba(247, 248, 252, 0.9);
  border: 1px solid rgba(23, 32, 51, 0.08);
  overflow: auto;
}

.preview-shell {
  display: grid;
  gap: 14px;
}

.empty {
  display: grid;
  place-items: center;
  text-align: center;
  color: rgba(23, 32, 51, 0.5);
}

.page-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.page-tab {
  min-height: 44px;
  border: 1px solid rgba(23, 32, 51, 0.12);
  background: rgba(255, 255, 255, 0.7);
  color: #172033;
  border-radius: 999px;
  padding: 8px 14px;
}

.page-tab.active {
  background: #172033;
  color: white;
}

.selection-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: rgba(23, 32, 51, 0.7);
  font-size: 0.92rem;
}

.link-btn {
  min-height: 44px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  color: var(--accent-dark);
  font-weight: 700;
}

.preview-stage {
  position: relative;
  width: 100%;
  user-select: none;
  touch-action: pan-y pinch-zoom;
}
.preview-stage.selection-mode { touch-action: none; cursor: crosshair; }

.preview-image {
  width: 100%;
  border-radius: 14px;
  display: block;
}

.selection-box {
  position: absolute;
  border: 2px solid var(--accent);
  background: rgba(204, 95, 45, 0.14);
  border-radius: 10px;
  box-shadow: 0 0 0 9999px rgba(23, 32, 51, 0.08);
  pointer-events: none;
}

.result {
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 960px) {
  .hero,
  .workspace {
    grid-template-columns: 1fr;
  }

  .controls,
  .action-row {
    grid-template-columns: 1fr;
  }

  .selection-hint {
    align-items: flex-start;
    flex-direction: column;
  }
}

/* Final theme layer: intentionally last so no legacy standalone color wins. */
.layout { color: var(--md-on-surface); background: var(--md-surface); }
.hero-copy, .hero-panel, .panel { background: var(--md-surface-container); border-color: var(--md-outline-variant); box-shadow: var(--md-shadow); border-radius: var(--radius-md); backdrop-filter: none; }
.hero-text, .meta, .field span, .selection-hint, .empty { color: var(--md-on-surface-variant); }
.upload-card { border-color: var(--md-outline); background: var(--md-surface-container-high); border-radius: var(--radius-md); }
.upload-subtitle { color: var(--md-on-surface-variant); }
.preview, .result { color: var(--md-on-surface); background: var(--md-surface); border-color: var(--md-outline-variant); border-radius: var(--radius-sm); }
.primary-btn { background: var(--md-primary); color: var(--md-on-primary); }
.secondary-btn, select, .page-tab { color: var(--md-on-surface); background: var(--md-surface); border-color: var(--md-outline-variant); }
.page-tab.active { color: var(--md-on-primary); background: var(--md-primary); }
.link-btn, .eyebrow { color: var(--md-primary); }
.selection-box { border-color: var(--md-primary); background: color-mix(in srgb, var(--md-primary) 14%, transparent); }

</style>
