#!/usr/bin/env python3
"""Rebuild art-fill.json: pictures for cards that have none on TCGdex.

Sources
  English            pokemontcg.io (images.pokemontcg.io / images.scrydex.com), matched by set and number
                     (Classic Collections by name, they are renumbered).
  Japanese           Limitless TCG's card images, by set code and number (modern sets).
  Chinese (繁中/简中) Mostly reprints of Japanese sets with the same set code and number: they reuse the
                     Japanese picture, but only when both cards are the same Pokémon.

Every picture address is checked to exist before it is kept. Entries from the previous file are kept
for cards that still have no picture on TCGdex, so a source being down during a run loses nothing.

Usage: python3 tools/build_art.py            (run from the repository root, standard library only)
"""
import concurrent.futures as cf
import json
import re
import sys
import time
import urllib.error
import urllib.request

TCG = 'https://api.tcgdex.net/v2'
PT = 'https://api.pokemontcg.io/v2'
LIM = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc'
HEADERS = {'User-Agent': 'pokedex-binders-art-refresh/1.0 (personal collection app; monthly)'}
OUT = 'art-fill.json'

POCKET = re.compile(r'^(P-A|[AB]\d)')                    # TCG Pocket (the mobile game): not physical cards
MANUAL = {'30th-c': 'me55c', 'fut2020': 'fut20', 'swsh12.5gg': 'swsh12pt5gg'}
BY_NAME = {'30th-c', 'cel25cc'}                          # renumbered collections: match by card name


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get(url, tries=8):
    """GET JSON with retries (pokemontcg.io often answers 500/502/503)."""
    for t in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=90) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ConnectionError) as e:
            if isinstance(e, urllib.error.HTTPError) and e.code == 404:
                raise
            time.sleep(min(30, 2 * (t + 1)))
    raise RuntimeError('gave up: ' + url)


def exists(url):
    """True only for a real picture (pokemontcg.io serves a placeholder with status 404)."""
    for t in range(3):
        try:
            req = urllib.request.Request(url, method='HEAD', headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status == 200
        except urllib.error.HTTPError:
            return False
        except Exception:
            time.sleep(2 * (t + 1))
    return False


def check_all(cands):
    """{key: url} -> only the entries whose picture exists."""
    with cf.ThreadPoolExecutor(16) as ex:
        ok = dict(zip(cands, ex.map(exists, cands.values())))
    return {k: v for k, v in cands.items() if ok[k]}


def set_of(card_id):
    return card_id.rsplit('-', 1)[0]


def norm(s):
    s = (s or '').lower().replace('pokémon', 'pokemon').replace('é', 'e').replace('&', 'and')
    return re.sub(r'[^a-z0-9]', '', s)


def numkey(n):
    n = n.upper().replace(' ', '')
    m = re.match(r'^([A-Z]*)0*(\d+)([A-Z_]*)$', n)
    return (m.group(1), m.group(2), m.group(3)) if m else n


# ---------- English: pokemontcg.io ----------
def english():
    td_sets = get(f'{TCG}/en/sets')
    cards = get(f'{TCG}/en/cards?category=Pokemon')
    need = [c for c in cards if not c.get('image') and not POCKET.match(set_of(c['id']))]
    pt_sets, page = [], 1
    while True:
        d = get(f'{PT}/sets?pageSize=30&page={page}&orderBy=releaseDate')
        pt_sets += d['data']
        if len(d['data']) < 30:
            break
        page += 1
    pt_ids = {s['id'] for s in pt_sets}
    by_name = {}
    for s in pt_sets:
        by_name.setdefault(norm(s['name']), []).append(s['id'])
    smap = {}
    for s in td_sets:
        i = s['id']
        if i in MANUAL:
            smap[i] = MANUAL[i]
        elif i in pt_ids:
            smap[i] = i
        elif i.replace('.', 'pt') in pt_ids:
            smap[i] = i.replace('.', 'pt')
        elif len(by_name.get(norm(s['name']), [])) == 1:
            smap[i] = by_name[norm(s['name'])][0]
    log(f'english: {len(need)} cards without a picture, {len(smap)} of {len(td_sets)} sets mapped')

    pt_cards, failed = {}, []
    for ps in sorted({smap[set_of(c['id'])] for c in need if set_of(c['id']) in smap}):
        lst, page = [], 1
        try:
            while True:
                d = get(f'{PT}/cards?q=set.id:{ps}&select=id,name,number,images&pageSize=100&page={page}')
                lst += d['data']
                if len(d['data']) < 100:
                    break
                page += 1
            pt_cards[ps] = lst
        except Exception as e:
            failed.append(ps)
            log('  could not list', ps, e)
    cands = {}
    for c in need:
        s = set_of(c['id'])
        pool = pt_cards.get(smap.get(s), [])
        if s in BY_NAME:
            hit = sorted((p for p in pool if norm(p['name']) == norm(c['name'])), key=lambda p: p['number'])
        else:
            hit = [p for p in pool if numkey(p['number']) == numkey(c['localId'])] or \
                  [p for p in pool if numkey(p['number'].split('_')[0]) == numkey(c['localId'])]
            if len(hit) > 1:
                hit = [p for p in hit if norm(p['name']) == norm(c['name'])] or hit
        if hit:
            cands[c['id']] = hit[0]['images']['small']
    ok = check_all(cands)
    log(f'english: {len(ok)} pictures found (sets not listed this run: {failed or "none"})')
    return ok, {c['id'] for c in need}


# ---------- Japanese (Limitless) + Chinese (same set and number as Japanese) ----------
def asian():
    intl = json.load(open('names-intl.json', encoding='utf-8'))   # index = Pokédex number - 1: [ja, zh-Hant, zh-Hans]
    names = {'ja': [], 'zh': []}
    for i, (ja, hant, hans) in enumerate(intl):
        names['ja'].append((ja, i + 1))
        names['zh'] += [(hant, i + 1)] + ([(hans, i + 1)] if hans != hant else [])
    for k in names:
        names[k].sort(key=lambda x: -len(x[0]))

    def dex(kind, card_name):                    # longest Pokémon name inside the card name
        return next((n for nm, n in names[kind] if nm and nm in (card_name or '')), None)

    ja = get(f'{TCG}/ja/cards?category=Pokemon')
    need = {'ja:' + c['id'] for c in ja if not c.get('image') and not POCKET.match(set_of(c['id']))}
    cands = {}
    for c in ja:
        m = re.match(r'^(.+)-0*(\d+)$', c['id'])
        if c.get('image') or not m or POCKET.match(m.group(1)):
            continue
        cands['ja:' + c['id']] = f'{LIM}/{m.group(1)}/{m.group(1)}_{m.group(2)}_R_JP_SM.png'
    ja_ok = check_all(cands)
    log(f'japanese: {len(need)} cards without a picture, {len(ja_ok)} found on Limitless')

    ja_pic = {c['id']: c['image'] for c in ja if c.get('image')}
    ja_pic.update({k[3:]: v for k, v in ja_ok.items()})
    ja_dex = {c['id']: dex('ja', c['name']) for c in ja}
    out = dict(ja_ok)
    for lang in ('zh-tw', 'zh-cn'):
        try:
            zh = get(f'{TCG}/{lang}/cards?category=Pokemon')
        except Exception as e:
            log('  could not list', lang, e)
            continue
        n = 0
        for c in zh:
            if c.get('image') or POCKET.match(set_of(c['id'])):
                continue
            need.add(f'{lang}:{c["id"]}')
            d = dex('zh', c['name'])
            if c['id'] in ja_pic and d and d == ja_dex.get(c['id']):
                out[f'{lang}:{c["id"]}'] = ja_pic[c['id']]
                n += 1
        log(f'{lang}: {n} cards use the matching Japanese picture')
    return out, need


# The file is kept small: a Limitless picture that follows from the card id is stored as "L",
# and the common hosts are shortened. index.html (artOf) expands them again.
PREFIXES = [('@t/', 'https://assets.tcgdex.net/'), ('@p/', 'https://images.pokemontcg.io/'),
            ('@s/', 'https://images.scrydex.com/pokemon/')]


def lim_url(key):
    raw = key.split(':', 1)[1] if ':' in key else key
    m = re.match(r'^(.+)-0*(\d+)$', raw)
    return f'{LIM}/{m.group(1)}/{m.group(1)}_{m.group(2)}_R_JP_SM.png' if m else None


def compact(key, url):
    if url == 'L' or url == lim_url(key):
        return 'L'
    for short, full in PREFIXES:
        if url.startswith(full):
            return short + url[len(full):]
    return url


def main():
    try:
        old = json.load(open(OUT, encoding='utf-8'))
    except Exception:
        old = {}
    en, en_need = english()
    asia, asia_need = asian()
    still = en_need | asia_need
    art = {k: v for k, v in old.items() if k in still}   # keep earlier finds for cards still without a TCGdex picture
    art.update(en)
    art.update(asia)
    art = {k: compact(k, v) for k, v in sorted(art.items())}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(art, f, ensure_ascii=False, separators=(',', ':'))
    added = len(set(art) - set(old))
    removed = len(set(old) - set(art))
    log(f'{OUT}: {len(art)} pictures ({added} new, {removed} no longer needed)')


if __name__ == '__main__':
    main()
