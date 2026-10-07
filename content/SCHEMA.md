# Content format (seed data)

All seed content lives in this folder as JSON and is loaded into PostgreSQL by `pnpm db:seed`.
Nothing here is published to users as "official" unless it carries `source_type: "OFFICIAL"` **and** `needs_verification: false`.

## Provenance fields (on every fact-like object)

| field | values | meaning |
|---|---|---|
| `source_key` | key into the file's `sources[]`, or `null` | where the info comes from |
| `confidence` | `HIGH` \| `MEDIUM` \| `LOW` | HIGH = explicit official text; MEDIUM = official but older session / reliable press; LOW = community or suggestion |
| `needs_verification` | boolean | `true` = **SUGGESTED** by the research team (plausible, not confirmed). Admin must verify before it is shown as fact. |
| `source_quote` | string \| null | verbatim excerpt from the source supporting the claim |

`sources[].source_type`: `OFFICIAL` (concours.gov.tn, ministries, JORT, public institutions), `SECONDARY` (press relaying an official notice), `COMMUNITY` (forums, Facebook groups, candidate reports), `SUGGESTED` (no source — editorial estimate).

## `competitions/<family-slug>.json`

```jsonc
{
  "family": {
    "slug": "douane", "field": "SECURITY",              // SECURITY|CUSTOMS|EDUCATION|HEALTH|FINANCE|PUBLIC_COMPANY|ADMINISTRATION|DEFENSE|TECHNICAL
    "organization": { "slug": "douane-tunisienne", "name_ar": "...", "name_fr": "...", "ministry_fr": "...", "website": "https://..." },
    "name_ar": "...", "name_fr": "...",
    "description_ar": "...", "description_fr": "...",
    "frequency": "ANNUAL|BIENNIAL|IRREGULAR|UNKNOWN", "frequency_confidence": "LOW",
    "popularity": 1-5,                                    // editorial estimate of audience size
    "keywords": ["..."]                                  // for search
  },
  "sources": [ { "key": "s1", "title": "...", "url": "https://...", "publisher": "...", "source_type": "OFFICIAL", "publication_date": "2025-03-01|null", "retrieved_at": "2026-10-07", "confidence": "HIGH", "notes": "" } ],
  "editions": [ { "year": 2025, "session_label": "...", "status": "ANNOUNCED|OPEN|CLOSED|EXAM_DONE|RESULTS|EXPECTED", "registration_open": "YYYY-MM-DD|null", "registration_deadline": "YYYY-MM-DD|null", "exam_date": "YYYY-MM-DD|null", "positions_count": null, "candidates_count": null, "source_key": "s1", "confidence": "HIGH", "needs_verification": false } ],
  "positions": [ {
      "slug": "agent", "title_ar": "...", "title_fr": "...",
      "diploma_level": "NONE|PRIMARY|NINTH|SECONDARY|BAC|BAC_PLUS_2|LICENCE|MASTER|ENGINEER|DOCTORATE|MEDICINE",
      "eligibility": {
        "min_age": 18, "max_age": 30, "genders": ["M","F"], "nationality": "TN",
        "diplomas": ["BAC"], "specialties": [], "min_height_cm_male": null, "min_height_cm_female": null,
        "marital_status": null, "other_ar": ["..."], "other_fr": ["..."],
        "source_key": "s1", "confidence": "MEDIUM", "needs_verification": true, "source_quote": null
      },
      "phases": [ { "order": 1, "kind": "WRITTEN|PHYSICAL|ORAL|PSYCHOTECH|MEDICAL|FILE_REVIEW|INTERVIEW|TRAINING", "name_ar": "...", "name_fr": "...", "is_eliminatory": true, "duration_minutes": null, "description_ar": "...", "description_fr": "...", "source_key": "s1", "confidence": "MEDIUM", "needs_verification": true } ],
      "subjects": [ { "phase_order": 1, "domain": "CULTURE_GENERALE|ARABIC|FRENCH|ENGLISH|LOGIC|NUMERICAL|PSYCHOTECH|SPECIALTY", "specialty_key": null, "name_ar": "...", "name_fr": "...", "coefficient": null, "duration_minutes": null, "question_count": null, "source_key": null, "confidence": "LOW", "needs_verification": true } ],
      "physical_tests": [ { "name_ar": "...", "name_fr": "...", "details_ar": "...", "details_fr": "...", "source_key": null, "confidence": "LOW", "needs_verification": true } ],
      "required_documents": [ { "text_ar": "...", "text_fr": "...", "source_key": "s1", "confidence": "MEDIUM", "needs_verification": true } ],
      "blueprint": { "total_minutes": 120, "fidelity": "OFFICIAL_FORMAT|APPROXIMATED", "sections": [ { "domain": "FRENCH", "specialty_key": null, "count": 20, "minutes": 30 } ] }
  } ],
  "specialty_syllabus": [ { "key": "spec.douane.legislation", "parent_key": null, "level": "UNIT|TOPIC", "title_ar": "...", "title_fr": "...", "scope": "OFFICIAL_PROGRAM|INFERRED_FROM_PAST_EXAMS|SUGGESTED", "source_key": null, "objectives": [ { "key": "...", "text_ar": "...", "text_fr": "..." } ] } ],
  "past_exams": [ { "year": 2019, "title": "...", "url": "https://...", "source_type": "COMMUNITY", "is_verified": false } ],
  "tips_ar": ["..."], "tips_fr": ["..."],
  "research_notes": "what could not be verified, what to check"
}
```

## `syllabus/common.json`

Shared general-skills syllabus (culture générale, langues, logique, numérique, psychotechnique) — `scope: GENERAL_SKILL`.

## `questions/<bank>.json`

```jsonc
{
  "bank": "fr-grammaire", "domain": "FRENCH",
  "specialty_syllabus": [],            // optional extra TOPIC nodes for specialty banks (same shape as above)
  "questions": [ {
    "id": "fr-gram-0001",               // globally unique, stable
    "type": "MCQ_SINGLE|MCQ_MULTI|TRUE_FALSE|MATCHING|ORDERING|NUMERIC",
    "language": "ar|fr|en",
    "stem": "...",
    "options": [ { "id": "a", "text": "..." } ],          // MATCHING: {"id":"l1","text":..,"side":"left"} / side right
    "correct": ["a"],                                      // MCQ/TF: option ids; NUMERIC: {"value": 42, "tolerance": 0}; MATCHING: {"pairs": [["l1","r2"]]}; ORDERING: {"order": ["c","a","b"]}
    "explanation": "...",                                  // why the answer is right AND why the distractors are wrong
    "difficulty": "EASY|MEDIUM|HARD|EXPERT",
    "topic_key": "fr.grammaire",                            // syllabus TOPIC key
    "objective_key": "fr.grammaire.o1",
    "families": ["*"],                                     // "*" = all families using this domain; or list of family slugs
    "origin": "AI_GENERATED|PAST_EXAM_REWRITTEN|AUTHORED",
    "source_key": null, "year": null,
    "valid_until": null,                                   // for time-sensitive culture générale
    "tags": []
  } ]
}
```

## `lessons/<group>.json`

```jsonc
{
  "group": "cg",
  "lessons": [ {
    "topic_key": "cg.tunisie-institutions",       // TOPIC key from syllabus/common.json or a specialty_syllabus
    "language": "ar|fr|en",
    "title": "...",
    "body_md": "## ...\n\n- ...",                 // Markdown subset: ##/### headings, paragraphs, - lists, 1. lists, **bold**, > quote
    "est_minutes": 10,
    "origin": "AI_GENERATED",
    "sources": [ { "title": "...", "url": "https://...", "source_type": "OFFICIAL|SECONDARY" } ],
    "needs_verification": false                  // true when a Tunisia-specific fact could not be confirmed
  } ]
}
```
Seeded with status `AI_REVIEWED` (shown with a "beta" badge only when CONTENT_BETA_MODE=true) until a human reviewer approves them.
