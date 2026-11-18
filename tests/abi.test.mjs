// Tests for the ABI panel's Markdown renderer: ABI's answers are shown as HTML,
// so everything from the model or the data must be escaped before formatting.
// Run: node --test tests/*.test.mjs
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { md } from "../js/abi.js";

describe("ABI answer rendering", () => {
  test("escapes HTML from the model or the data", () => {
    const html = md('Farmer <img src=x onerror="alert(1)"> & <script>bad()</script>');
    assert.ok(!html.includes("<img"));
    assert.ok(!html.includes("<script"));
    assert.ok(html.includes("&lt;img"));
    assert.ok(html.includes("&amp;"));
  });

  test("bold, italic and code", () => {
    assert.equal(md("**Saa** is *first* in `cocoa_receptions`"), "<p><strong>Saa</strong> is <em>first</em> in <code>cocoa_receptions</code></p>");
  });

  test("bullets and numbered lists", () => {
    assert.equal(md("- one\n- two"), "<ul><li>one</li><li>two</li></ul>");
    assert.equal(md("1. one\n2. two"), "<ol><li>one</li><li>two</li></ol>");
  });

  test("headings and paragraphs", () => {
    assert.equal(md("## Résumé\n\nLigne 1\nLigne 2"), "<h4>Résumé</h4><p>Ligne 1<br>Ligne 2</p>");
  });

  test("tables, with numbers aligned right", () => {
    const html = md("| Zone | kg |\n|---|---:|\n| Saa | 14 691 |\n| Obala | 6 214 kg |");
    assert.match(html, /<table><thead><tr><th>Zone<\/th><th>kg<\/th><\/tr><\/thead>/);
    assert.match(html, /<td class="">Saa<\/td><td class="n">14 691<\/td>/);
    assert.match(html, /<td class="n">6 214 kg<\/td>/);
  });

  test("table cells are escaped too", () => {
    const html = md("| a |\n|---|\n| <b onclick=x>hi</b> |");
    assert.ok(!html.includes("<b onclick"));
  });

  test("empty answer gives empty HTML", () => {
    assert.equal(md(""), "");
    assert.equal(md(null), "");
  });
});
