import { strToU8, zip } from 'fflate'
import { abortError, checkAbort, readableText } from './wordLayout.js'

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const xml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char])
const twips = value => Math.round(value * 20)
const emu = value => Math.round(value * 12700)

function section(page) {
  return `<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="${twips(page.width)}" w:h="${twips(page.height)}"${page.width > page.height ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`
}

function background(page, id) {
  if (!page.hasImage) return ''
  const cx = emu(page.width), cy = emu(page.height)
  return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="Page ${id}" descr="原页面的图片与线条"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="page-${id}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImage${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
}

function textFrame(run, id, page) {
  const text = readableText(run.text)
  if (!text || ![run.x, run.y, run.width, run.height, run.fontSize].every(Number.isFinite)) return ''
  const x = Math.max(0, run.x), y = Math.max(0, run.y)
  const width = Math.min(run.width + 1, page.width - x)
  if (width <= 0 || y >= page.height) return ''
  const fontSize = Math.max(5, Math.min(200, run.fontSize))
  const size = Math.round(fontSize * 2)
  const color = /^[0-9a-f]{6}$/i.test(run.color || '') ? run.color : '000000'
  // Positioned paragraphs keep editable text at its original page location.
  // fitText prevents font substitution from wrapping a PDF line into adjacent content.
  return `<w:p><w:pPr><w:framePr w:w="${twips(width)}" w:h="${twips(Math.max(run.height, fontSize * 1.2))}" w:hRule="atLeast" w:wrap="none" w:vAnchor="page" w:hAnchor="page" w:x="${twips(x)}" w:y="${twips(y)}" w:hSpace="0" w:vSpace="0"/><w:widowControl w:val="0"/><w:spacing w:before="0" w:after="0" w:line="${twips(fontSize * 1.05)}" w:lineRule="exact"/><w:ind w:left="0" w:right="0"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${xml(run.font || 'Arial')}" w:hAnsi="${xml(run.font || 'Arial')}" w:eastAsia="${xml(run.eastAsia || '宋体')}" w:cs="Arial"/>${run.bold ? '<w:b/>' : ''}${run.italic ? '<w:i/>' : ''}<w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:fitText w:val="${twips(run.width)}" w:id="${id}"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`
}

export function createWordDocument() {
  const files = {}, pages = []
  let bytes = 0, textId = 0
  return {
    addPage({ width, height, runs = [], image }) {
      if (!(width > 0 && height > 0)) throw new Error('PDF 页面尺寸无效。')
      // Word limits a page dimension to 22 inches; scale all content together.
      const scale = Math.min(1, 1584 / Math.max(width, height))
      const page = { width: width * scale, height: height * scale, hasImage: Boolean(image) }
      const scaled = runs.map(run => ({ ...run, x: run.x * scale, y: run.y * scale, width: run.width * scale, height: run.height * scale, fontSize: run.fontSize * scale }))
      page.content = scaled.map(run => textFrame(run, ++textId, page)).join('')
      bytes += (image?.length || 0) + page.content.length * 2
      if (bytes > 120 * 1024 * 1024) throw new Error('转换内容较大，请减少页码范围或选择“标准”清晰度后重试。')
      pages.push(page)
      if (image) files[`word/media/page-${pages.length}.png`] = [image, { level: 0 }]
    },
    async pack(signal) {
      checkAbort(signal)
      if (!pages.length) throw new Error('没有可导出的页面。')
      const body = pages.map((page, index) => {
        const last = index === pages.length - 1
        return `${page.content}<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>${last ? '' : section(page)}</w:pPr>${background(page, index + 1)}</w:p>${last ? section(page) : ''}`
      }).join('')
      files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`)
      files['_rels/.rels'] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rDoc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`)
      files['word/document.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}</w:body></w:document>`)
      files['word/styles.xml'] = strToU8(`<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="宋体"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`)
      files['word/settings.xml'] = strToU8(`<w:settings xmlns:w="${W}"><w:displayBackgroundShape/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`)
      files['word/_rels/document.xml.rels'] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rSettings" Type="${R}/settings" Target="settings.xml"/>${pages.map((page, i) => page.hasImage ? `<Relationship Id="rImage${i + 1}" Type="${R}/image" Target="media/page-${i + 1}.png"/>` : '').join('')}</Relationships>`)
      return new Promise((resolve, reject) => {
        const abort = () => { terminate(); reject(abortError()) }
        const terminate = zip(files, { level: 6 }, (error, output) => {
          signal?.removeEventListener('abort', abort)
          if (error) reject(error)
          else resolve(new Blob([output], { type: DOCX_MIME }))
        })
        signal?.addEventListener('abort', abort, { once: true })
      })
    },
  }
}
