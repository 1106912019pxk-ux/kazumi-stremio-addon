function parsedOrigin(value, replacement = '') {
  try {
    return new URL(String(value ?? '').replaceAll('@source', replacement)).origin;
  } catch {
    return '';
  }
}

function isOfficialSoraniRule(input, id) {
  return (
    String(id ?? '').trim().toLowerCase() === 'sorani' &&
    String(input?.name ?? '').trim().toLowerCase() === 'sorani' &&
    parsedOrigin(input?.baseURL) === 'https://www.sorani.net' &&
    parsedOrigin(input?.chapterApiConfig?.request?.url, '1') === 'https://api.sorani.cc'
  );
}

function adaptOfficialSoraniRule(input) {
  return {
    ...input,
    chapterApiConfig: {
      ...input.chapterApiConfig,
      episodeVariables: {
        ...input.chapterApiConfig?.episodeVariables,
        episodeId: '$.episodeId',
      },
    },
    playMode: 'api',
    playApiConfig: {
      request: {
        method: 'GET',
        url: 'https://api.sorani.cc/sorani-cms/api/video/episode/@episodeId/play',
        headers: {
          Origin: 'https://www.sorani.net',
          Referer: 'https://www.sorani.net/',
        },
      },
      urlPath: '$.data.playUrl',
      canPlayPath: '$.data.canPlay',
      mediaHeaders: {
        Origin: 'https://www.sorani.net',
        Referer: 'https://www.sorani.net/',
      },
    },
  };
}

// Compatibility adapters only fill gaps that the upstream Kazumi rule format
// cannot currently describe. Each adapter is deliberately pinned to the rule
// id and declared upstream origins so a similarly named custom rule cannot
// redirect privileged request headers elsewhere.
export function adaptKazumiRuleInput(input, { id } = {}) {
  if (isOfficialSoraniRule(input, id)) return adaptOfficialSoraniRule(input);
  return input;
}
