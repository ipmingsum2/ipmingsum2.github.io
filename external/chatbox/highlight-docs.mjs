import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import bash from "highlight.js/lib/languages/bash";
import powershell from "highlight.js/lib/languages/powershell";
import { JSDOM } from "jsdom";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("powershell", powershell);

// Render at build time: no highlighter download or script execution in the guide.
export function highlightDocs(html) {
  const dom = new JSDOM(html);
  for (const code of dom.window.document.querySelectorAll("pre > code")) {
    const language = code.dataset.language;
    if (!hljs.getLanguage(language))
      throw Error(`Unknown example language: ${language}`);
    code.innerHTML = hljs.highlight(code.textContent, { language }).value;
    code.classList.add("hljs", `language-${language}`);
  }
  const result = dom.serialize();
  dom.window.close();
  return result;
}
