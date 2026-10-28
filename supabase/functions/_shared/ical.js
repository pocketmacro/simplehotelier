/* SimpleHotelier — minimal iCalendar (RFC 5545) parse/build helpers.
   Plain ESM so the same file runs in Deno Edge Functions and Node tests.
   Dates are handled as YYYY-MM-DD strings; a stay is [check_in, check_out). */
import { SITE } from "./site.js";

/** YYYYMMDD or YYYY-MM-DD or YYYYMMDDTHHMMSS(Z) -> YYYY-MM-DD (date part only). */
export function icalDateToISO(raw) {
  const v = String(raw || "").trim();
  const m = v.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function addDaysISO(iso, days) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nightsBetween(a, b) {
  return Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 864e5);
}

/* Unfold continuation lines (lines starting with space/tab belong to the previous one). */
function unfold(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
}

function unescapeText(v) {
  return String(v || "").replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

export function escapeText(v) {
  return String(v || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Parse .ics text into [{ uid, summary, start, end }] with ISO dates, end > start guaranteed. */
export function parseICS(text) {
  const lines = unfold(text).split("\n");
  const events = [];
  let cur = null;
  for (const line of lines) {
    const t = line.trim();
    if (t === "BEGIN:VEVENT") { cur = {}; continue; }
    if (t === "END:VEVENT") {
      if (cur) {
        const start = icalDateToISO(cur.start);
        let end = icalDateToISO(cur.end);
        if (start) {
          if (!end || end <= start) end = addDaysISO(start, 1);
          events.push({ uid: cur.uid || "", summary: unescapeText(cur.summary), start, end });
        }
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = t.indexOf(":");
    if (colon < 0) continue;
    const key = t.slice(0, colon).split(";")[0].toUpperCase();
    const val = t.slice(colon + 1);
    if (key === "UID") cur.uid = val.trim();
    else if (key === "SUMMARY") cur.summary = val;
    else if (key === "DTSTART") cur.start = val;
    else if (key === "DTEND") cur.end = val;
  }
  return events;
}

/** Build an .ics calendar from [{ uid, summary, start, end, description? }]. */
export function buildICS(events, calName) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${SITE.name}//Booking Calendar//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calName || SITE.name + " bookings")}`
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${e.start.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${e.end.replace(/-/g, "")}`,
      `SUMMARY:${escapeText(e.summary)}`
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    lines.push("STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** Stable short confirmation code for an imported event. */
export function importCode(uid) {
  let h = 0;
  const s = String(uid || "");
  for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
  return "ICAL-" + h.toString(36).toUpperCase().padStart(6, "0").slice(0, 8);
}
