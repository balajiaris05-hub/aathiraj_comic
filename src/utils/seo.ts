import { Comic } from '../types/comic';

export const DEFAULT_HOME_TITLE = 'Aathirai Comic | Read Original Tamil & Indian Comics Online';
export const DEFAULT_HOME_DESCRIPTION =
  'Explore Aathirai Comic to read digital comics online. Discover original Tamil comic and Indian comic series across mythology, action, and manga.';
export const DEFAULT_OG_IMAGE_PATH = '/assets/og-hero-banner.jpg';

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
  'indian digital comics',
  'online tamil comics',
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
  'Aathirai Comic',
  'Aathirai Comics',
  'Tamil comic',
  'Indian comic',
  'online Tamil comics',
  'Indian digital comics',
  'read digital comics online',
  'Tamil comics',
  'Indian comics',
  'Aathirai_Comic',
  'Tamil manga',
  'Indian webtoons',
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

export function getComicSlug(comic: Pick<Comic, 'id' | 'slug'>): string {
  return encodeURIComponent((comic.slug || comic.id).trim());
}

export function getComicPath(comic: Pick<Comic, 'id' | 'slug'>): string {
  return `/comic/${getComicSlug(comic)}`;
}

export function resolveSeoImageUrl(
  imageUrl: string | undefined,
  origin: string,
  comicSlugOrId?: string
): string {
  const cleanOrigin = origin.replace(/\/+$/, '');
  const trimmed = (imageUrl || '').trim();
  if (!trimmed) {
    return `${cleanOrigin}${DEFAULT_OG_IMAGE_PATH}`;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('data:image/')) {
    return comicSlugOrId
      ? `${cleanOrigin}/api/comics/${encodeURIComponent(comicSlugOrId)}/og-image`
      : `${cleanOrigin}${DEFAULT_OG_IMAGE_PATH}`;
  }
  if (trimmed.startsWith('/')) {
    return `${cleanOrigin}${trimmed}`;
  }
  return `${cleanOrigin}/${trimmed}`;
}

export function formatBookSeoTitle(bookTitle: string): string {
  return `${bookTitle} - Read Tamil & Indian Comic | Aathirai Comic`;
}

export function formatBookSeoDescription(comic: Comic): string {
  const genres = (comic.genre || []).slice(0, 3).join(', ') || 'Tamil & Indian Comic';
  const base = `${comic.title} by ${comic.authorName} (${genres}). ${
    comic.description || 'Read this original Tamil & Indian digital comic online on Aathirai Comic.'
  }`.replace(/\s+/g, ' ').trim();
  if (base.length <= 155) return base;
  return `${base.slice(0, 152).replace(/\s+\S*$/, '')}...`;
}

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
    'tamil comic tamil comics online tamil comics aathirai comic aathirai comics aathirai_comic indian comic indian comics indian digital comics general comic comic book manga webtoon',
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
  // Remove static placeholder script if present so crawlers see one clean dynamic graph
  const baseScript = document.getElementById('aathirai-base-jsonld');
  if (baseScript) {
    baseScript.remove();
  }

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
  const pathname = window.location.pathname || '/';
  const canonicalUrl = selectedComic
    ? `${origin}${getComicPath(selectedComic)}`
    : `${origin}${pathname}`;

  const liveGenres = Array.from(
    new Set(comics.flatMap((c) => c.genre || []).filter(Boolean))
  );
  const liveTitles = comics.map((c) => c.title).filter(Boolean);

  let title = DEFAULT_HOME_TITLE;
  let description = DEFAULT_HOME_DESCRIPTION;
  let ogType = 'website';
  let ogImage = `${origin}${DEFAULT_OG_IMAGE_PATH}`;
  let ogImageAlt = 'Aathirai Comic - Original Tamil & Indian Digital Comics Banner';

  if (selectedComic) {
    title = formatBookSeoTitle(selectedComic.title);
    description = formatBookSeoDescription(selectedComic);
    ogType = 'book';
    ogImage = resolveSeoImageUrl(
      selectedComic.bannerImage || selectedComic.coverImage,
      origin,
      selectedComic.slug || selectedComic.id
    );
    ogImageAlt = `${selectedComic.title} Tamil comic cover - Aathirai Comic`;
  } else if (currentTab === 'books') {
    const cleanSearch = (booksSearch || '').trim();
    const cleanGenre = booksGenre && booksGenre !== 'All' ? booksGenre : '';

    if (cleanSearch) {
      title = `${cleanSearch} - Read Tamil & Indian Comics | Aathirai Comic`;
      description = `Browse "${cleanSearch}" on Aathirai Comic. Read online Tamil comics, Indian digital comics, and original series.`;
    } else if (cleanGenre) {
      title = `${cleanGenre} Tamil & Indian Comics | Aathirai Comic`;
      description = `Read ${cleanGenre} Tamil comics and Indian digital comics online on Aathirai Comic. Free and premium series.`;
    } else {
      title = 'Browse Tamil & Indian Comic Books Online | Aathirai Comic';
      description =
        liveTitles.length > 0
          ? `Read ${liveTitles.slice(0, 3).join(', ')} and all Tamil & Indian digital comics online on Aathirai Comic.`
          : 'Browse all Tamil comics, Indian digital comics, mythology, action, fantasy, and manga series on Aathirai Comic.';
    }
  } else if (currentTab === 'authors') {
    title = 'Tamil & Indian Comic Creators & Authors | Aathirai Comic';
    description =
      'Meet original Tamil and Indian comic book authors, illustrators, and storytellers publishing digital comics on Aathirai Comic.';
  } else if (currentTab === 'premium') {
    title = 'Premium Plans (₹49 / ₹249) - Read Digital Comics | Aathirai Comic';
    description =
      'Unlock unlimited online Tamil comics and Indian digital comics on Aathirai Comic with ₹49 Monthly or ₹249 6-Month passes.';
  } else if (currentTab === 'about') {
    title = 'About Aathirai Comic | Tamil & Indian Digital Comics Platform';
    description =
      'Learn how Aathirai Comic empowers Tamil comic and Indian comic creators with digital publishing and direct reader access.';
  }

  const combinedKeywords = Array.from(
    new Set([
      ...BASE_SEO_KEYWORDS,
      ...liveGenres.map((g) => `${g} comics`),
      ...liveGenres,
      ...liveTitles,
    ])
  )
    .slice(0, 45)
    .join(', ');

  document.title = title;
  setMetaTag('name', 'description', description);
  setMetaTag('name', 'keywords', combinedKeywords);
  setMetaTag('property', 'og:title', title);
  setMetaTag('property', 'og:description', description);
  setMetaTag('property', 'og:image', ogImage);
  setMetaTag('property', 'og:image:alt', ogImageAlt);
  setMetaTag('property', 'og:url', canonicalUrl);
  setMetaTag('property', 'og:type', ogType);
  setMetaTag('property', 'og:site_name', 'Aathirai Comic');
  setMetaTag('name', 'twitter:card', 'summary_large_image');
  setMetaTag('name', 'twitter:title', title);
  setMetaTag('name', 'twitter:description', description);
  setMetaTag('name', 'twitter:image', ogImage);
  setCanonicalLink(canonicalUrl);

  if (selectedComic) {
    const epCount = selectedComic.chapters?.reduce((s, ch) => s + (ch.episodes?.length || 0), 0) || 0;
    const bookUrl = `${origin}${getComicPath(selectedComic)}`;
    setDynamicJsonLd({
      '@context': 'https://schema.org',
      '@type': ['ComicSeries', 'Book'],
      '@id': `${bookUrl}#comic`,
      name: selectedComic.title,
      url: bookUrl,
      inLanguage: ['ta', 'en'],
      genre: selectedComic.genre,
      image: ogImage,
      keywords: [
        ...(selectedComic.genre || []),
        'Tamil comic',
        'Indian comic',
        'online Tamil comics',
        'Aathirai Comic',
      ].join(', '),
      description: selectedComic.description,
      author: {
        '@type': 'Person',
        name: selectedComic.authorName,
      },
      publisher: {
        '@type': 'Organization',
        name: 'Aathirai Comic',
        url: `${origin}/`,
      },
      numberOfEpisodes: epCount,
      numberOfPages: epCount,
      hasPart: (selectedComic.chapters || []).map((ch) => ({
        '@type': 'ComicIssue',
        name: `Chapter ${ch.chapterNumber}: ${ch.title}`,
        issueNumber: ch.chapterNumber,
        description: ch.synopsis || `${selectedComic.title} Chapter ${ch.chapterNumber}`,
        hasPart: (ch.episodes || []).map((ep) => ({
          '@type': 'Chapter',
          name: `Episode ${ep.episodeNumber}: ${ep.title}`,
          position: ep.episodeNumber,
          description: ep.synopsis || ep.title,
        })),
      })),
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: selectedComic.averageRating || 5,
        ratingCount: Math.max(1, selectedComic.totalViews || 1),
      },
    });
  } else {
    setDynamicJsonLd({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${origin}/#organization`,
          name: 'Aathirai Comic',
          alternateName: ['Aathirai Comic', 'Aathirai Comics', 'Aathirai_Comic'],
          url: `${origin}/`,
          logo: `${origin}${DEFAULT_OG_IMAGE_PATH}`,
          email: 'aathiraicomic@gmail.com',
          description:
            'Original Tamil comic and Indian digital comic publishing network for online Tamil comics and graphic novels.',
        },
        {
          '@type': 'WebSite',
          '@id': `${origin}/#website`,
          name: 'Aathirai Comic',
          alternateName: ['Aathirai Comic', 'Aathirai Comics'],
          url: `${origin}/`,
          inLanguage: ['ta', 'en'],
          keywords: combinedKeywords,
          publisher: {
            '@id': `${origin}/#organization`,
          },
          potentialAction: {
            '@type': 'SearchAction',
            target: {
              '@type': 'EntryPoint',
              urlTemplate: `${origin}/books?q={search_term_string}`,
            },
            'query-input': 'required name=search_term_string',
          },
        },
        {
          '@type': 'CollectionPage',
          '@id': `${canonicalUrl}#collection`,
          name: title,
          url: canonicalUrl,
          inLanguage: ['ta', 'en'],
          keywords: combinedKeywords,
          description,
          mainEntity: {
            '@type': 'ItemList',
            name: 'Aathirai Comic – Tamil & Indian Digital Comics Catalog',
            numberOfItems: comics.length,
            itemListElement: comics.slice(0, 50).map((comic, idx) => ({
              '@type': 'ListItem',
              position: idx + 1,
              url: `${origin}${getComicPath(comic)}`,
              name: comic.title,
              item: {
                '@type': ['ComicSeries', 'Book'],
                name: comic.title,
                genre: comic.genre,
                inLanguage: ['ta', 'en'],
                image: resolveSeoImageUrl(comic.coverImage, origin, comic.slug || comic.id),
                author: {
                  '@type': 'Person',
                  name: comic.authorName,
                },
                publisher: {
                  '@type': 'Organization',
                  name: 'Aathirai Comic',
                },
              },
            })),
          },
        },
      ],
    });
  }
}
