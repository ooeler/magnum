// Wertet den Text einer fotografierten Quittung aus: Wein in Dezilitern, Mineral in Stück, Total.
// Die Texterkennung liefert Fehler, darum ist das nur ein Vorschlag: In der App lässt sich alles korrigieren.
(function () {
  var WEIN = /\b(wein|weine|vin|vino|rotwein|weisswein|ros[eé]|prosecco|champagner|cava|cornalin|merlot|pinot|riesling|barolo|chasselas|fendant|d[oô]le|chardonnay|sauvignon|heida|humagne|syrah|shiraz|rioja|chianti|gamay|primitivo|amarone|malbec|tempranillo|magnum|flasche|fl\.)/i;
  var MINERAL = /\b(mineral|mineralwasser|wasser|henniez|valser|evian|aproz|acqua)\b/i;
  var TOTAL = /\b(total|summe|gesamt|zu zahlen|betrag)\b[^0-9]*([0-9]+[.,][0-9]{2})/i;

  // Menge am Zeilenanfang ("2 x", "2x", "2 "), sonst 1. Preise wie "12.50" zählen nicht
  function menge(z) {
    var m = z.match(/^\s*(\d{1,2})\s*[x×*]?\s+\D/i) || z.match(/^\s*(\d{1,2})\s*[x×*]\s*/i);
    return m ? +m[1] : 1;
  }
  // Grösse in Dezilitern: 75cl, 7.5dl, 1.5l, 750ml. Ohne Angabe: Flasche, beim Glas 1 dl, Magnum 15 dl
  function groesse(z) {
    var m = z.match(/(\d+(?:[.,]\d+)?)\s*(ml|cl|dl|l)\b/i);
    if (m) {
      var n = parseFloat(m[1].replace(",", ".")), e = m[2].toLowerCase();
      return e == "ml" ? n / 100 : e == "cl" ? n / 10 : e == "dl" ? n : n * 10;
    }
    if (/magnum/i.test(z)) return 15;
    if (/\b(glas|offen|ofen)\b/i.test(z)) return 1;
    return 7.5;
  }
  function quittungLesen(text) {
    var r = { wein_dl: 0, mineral: 0, total: null, zeilen: [] };
    String(text || "").split(/\r?\n/).forEach(function (z) {
      z = z.trim(); if (!z) return;
      var t = z.match(TOTAL); if (t) { r.total = parseFloat(t[2].replace(",", ".")); return }
      if (MINERAL.test(z)) { r.mineral += menge(z); r.zeilen.push(z); return }
      if (WEIN.test(z)) { r.wein_dl += menge(z) * groesse(z); r.zeilen.push(z) }
    });
    r.wein_dl = Math.round(r.wein_dl * 10) / 10;
    return r;
  }
  if (typeof module != "undefined") module.exports = quittungLesen; else window.quittungLesen = quittungLesen;
})();
