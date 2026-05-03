export function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function decodeEntitiesDeep(value: string): string {
  let decodedValue = value;

  for (let index = 0; index < 3; index += 1) {
    const nextValue = decodeEntities(decodedValue);

    if (nextValue === decodedValue) {
      break;
    }

    decodedValue = nextValue;
  }

  return decodedValue;
}

export function stripHtml(value: string): string {
  return decodeEntitiesDeep(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanSummary(value: string): string {
  return decodeEntitiesDeep(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
