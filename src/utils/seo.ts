import { Comic } from '../types/comic';

const PLATFORM_UMBRELLA_TERMS = new Set([
  'tamil',
  'tamil comic',
  'tamil comics',
  'aathirai',
  'aathirai comic',
  'aathiraicomic',
  'aathirai_comic',
  'indian',
  'indian comic',
  'indian comics',
  'general',
  'general comic',
  'general comics',
  'comic',
  'comics',
  'comic book',
  'comic books',
  'book',
  'books',
  'manga',
  'webtoon',
  'webtoons',
]);

const BASE_SEO_KEYWORDS = [
  'Tamil comic',
  'Tamil comics',
  'Aathirai comic',
  'Aathirai_Comic',
  'Indian comic',
  'Indian comics',
  'general comic',
  'comic book',
  'Tamil manga',
  'Indian webtoons',
  'read Tamil comics online',
  'Tamil graphic novels',
  'Action comics',
  'Fantasy comics',
  'Mythology comics',
  'Sci-Fi comics',
  'Cyberpunk comics',
  'Romance comics',
  'Slice of Life comics',
  'Horror comics',
];

/**
 * Smart multi-term search matcher for Tamil, Indian, Aathirai, general comic,
 * category/genre, author, title, slug, synopsis, and episode titles.
 */
export function matchesComicSearchQuery(comic: Comic, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  const searchableParts: string[] = [
    comic.title || '',
    comic.slug || '',
    comic.authorName || '',
    comic.description || '',
    ...(comic.genre || []),
    ...(comic.tags || []),
    ...(comic.chapters || []).flatMap((ch) => [
      ch.title || '',
      ...(ch.episodes || []).map((ep) => `${ep.title || ''} ${ep.synopsis || ''}`),
    ]),
    // Platform-wide editorial taxonomy so broad searches for Tamil/Indian/Aathirai/General comics always surface the catalog
    'tamil comic tamil comics aathirai comic aathirai_comic indian comic indian comics general comic comic book manga webtoon',
  ];

  const corpus = searchableParts.join(' ').toLowerCase();
  if (corpus.includes(q)) return true;

  const tokens = q
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0) return true;

  return tokens.every((token) => {
    if (PLATFORM_UMBRELLA_TERMS.has(token)) return true;
    return corpus.includes(token);
  });
}

function setMetaTag(attrName: 'name' | 'property', attrValue: string, content: string) {
  let tag = document.querySelector(`meta[${attrName}="${attrValue}"]`) as HTMLMetaElement | null;
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attrName, attrValue);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

function setCanonicalLink(url: string) {
  let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', url);
}

function setDynamicJsonLd(payload: Record<string, unknown>) {
  let script = document.getElementById('aathirai-dynamic-jsonld') as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement('script');
    script.id = 'aathirai-dynamic-jsonld';
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(payload);
}

export interface DynamicSeoContext {
  currentTab: string;
  comics: Comic[];
  selectedComic?: Comic | null;
  booksSearch?: string;
  booksGenre?: string;
}

export function updateDocumentSeo({
  currentTab,
  comics,
  selectedComic,
  booksSearch,
  booksGenre,
}: DynamicSeoContext) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const origin = window.location.origin;
  const canonicalUrl = `${origin}${window.location.pathname}`;
  const liveGenres = Array.from(
    new Set(comics.flatMap((c) => c.genre || []).filter(Boolean))
  );
  const liveTitles = comics.map((c) => c.title).filter(Boolean);

  let title = 'Aathirai_Comic – Tamil Comics, Indian Comics & Webtoons';
  let description =
    'Read Tamil comics, Indian comics, webtoons, and manga on Aathirai_Comic. Explore action, mythology, fantasy, and general comics free or premium.';

  if (selectedComic) {
    const genreLabel = (selectedComic.genre || []).join(', ') || 'Comic Series';
    title = `${selectedComic.title} – Tamil & Indian Comic | Aathirai_Comic`;
    description = `${selectedComic.title} (${genreLabel}) by ${selectedComic.authorName}. Read on Aathirai_Comic — Tamil, Indian, and general comic book network.`;
  } else if (currentTab === 'books') {
    const cleanSearch = (booksSearch || '').trim();
    const cleanGenre = booksGenre && booksGenre !== 'All' ? booksGenre : '';

    if (cleanSearch) {
      title = `${cleanSearch} – Tamil & Indian Comics | Aathirai_Comic`;
      description = `Search results for "${cleanSearch}" on Aathirai_Comic. Discover Tamil comics, Indian comics, general comics, and matching series.`;
    } else if (cleanGenre) {
      title = `${cleanGenre} Comics – Tamil & Indian Books | Aathirai_Comic`;
      description = `Browse ${cleanGenre} comic books on Aathirai_Comic. Read free and premium Tamil comics, Indian comics, and original series.`;
    } else {
      title = 'Books – Tamil Comics, Indian Comics & All Series | Aathirai_Comic';
      description =
        liveTitles.length > 0
          ? `Explore ${liveTitles.slice(0, 4).join(', ')} and all Tamil comics, Indian comics, and general comic categories on Aathirai_Comic.`
          : 'Browse all Tamil comics, Indian comics, and general comic books across action, mythology, fantasy, sci-fi, and slice-of-life on Aathirai_Comic.';
    }
  } else if (currentTab === 'authors') {
    title = 'Comic Creators & Authors – Aathirai_Comic India';
    description =
      'Meet Tamil and Indian comic book authors, illustrators, and storytellers publishing original series on Aathirai_Comic.';
  } else if (currentTab === 'premium') {
    title = 'Premium Plans (₹49 / ₹249) – Unlimited Comics | Aathirai_Comic';
    description =
      'Unlock all Tamil comics, Indian comics, and exclusive episodes with Aathirai_Comic ₹49 Monthly or ₹249 6-Month Unlimited Pass via Razorpay.';
  } else if (currentTab === 'about') {
    title = 'About Aathirai_Comic – Tamil & Indian Digital Comics';
    description =
      'Learn about Aathirai_Comic, an Indian digital comic publishing platform built for Tamil comic readers, creators, and global manga fans.';
  }

  const combinedKeywords = Array.from(
    new Set([
      ...BASE_SEO_KEYWORDS,
      ...liveGenres.map((g) => `${g} comics`),
      ...liveGenres,
      ...liveTitles,
    ])
  )
    .slice(0, 40)
    .join(', ');

  document.title = title;
  setMetaTag('name', 'description', description);
  setMetaTag('name', 'keywords', combinedKeywords);
  setMetaTag('property', 'og:title', title);
  setMetaTag('property', 'og:description', description);
  setMetaTag('property', 'og:url', canonicalUrl);
  setMetaTag('name', 'twitter:title', title);
  setMetaTag('name', 'twitter:description', description);
  setCanonicalLink(canonicalUrl);

  if (selectedComic) {
    const epCount = selectedComic.chapters?.reduce((s, ch) => s + (ch.episodes?.length || 0), 0) || 0;
    setDynamicJsonLd({
      '@context': 'https://schema.org',
      '@type': 'Book',
      name: selectedComic.title,
      url: `${origin}/comic/${selectedComic.slug || selectedComic.id}`,
      inLanguage: ['en-IN', 'ta-IN'],
      genre: selectedComic.genre,
      keywords: [...(selectedComic.genre || []), 'Tamil comic', 'Indian comic', 'Aathirai comic'].join(', '),
      description: selectedComic.description,
      author: {
        '@type': 'Person',
        name: selectedComic.authorName,
      },
      publisher: {
        '@type': 'Organization',
        name: 'Aathirai_Comic',
      },
      numberOfPages: epCount,
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: selectedComic.averageRating || 5,
        ratingCount: Math.max(1, selectedComic.totalViews || 1),
      },
    });
  } else {
    setDynamicJsonLd({
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      url: canonicalUrl,
      inLanguage: ['en-IN', 'ta-IN'],
      keywords: combinedKeywords,
      description,
      mainEntity: {
        '@type': 'ItemList',
        name: 'Aathirai_Comic Books – Tamil, Indian & General Comics Catalog',
        numberOfItems: comics.length,
        itemListElement: comics.slice(0, 50).map((comic, idx) => ({
          '@type': 'ListItem',
          position: idx + 1,
          url: `${origin}/comic/${comic.slug || comic.id}`,
          name: comic.title,
          item: {
            '@type': 'Book',
            name: comic.title,
            genre: comic.genre,
            author: {
              '@type': 'Person',
              name: comic.authorName,
            },
          },
        })),
      },
    });
  }
}
