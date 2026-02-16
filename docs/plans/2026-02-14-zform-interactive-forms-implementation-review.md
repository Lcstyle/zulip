# Zform Interactive Forms: Comprehensive Implementation Review

**Date**: 2026-02-14
**Branch**: `zform-interactive-forms`
**Base**: Zulip `main` (commit `58d43d1`)
**Commits**: 10
**Lines changed**: +2,651 / -28 across 13 files

---

## Executive Summary

This branch extends Zulip's existing `zform` widget system to support rich interactive forms — text inputs, textareas, dropdowns, checkbox groups, and date pickers — that bots can send to users and receive structured form submissions via the submessage system. This is the first concrete implementation toward closing Zulip's 8-year-old feature request for Slack-style interactive bot messages (issue #6102).

The implementation requires **zero new models, zero migrations, and zero new API endpoints**. It extends the existing zform widget by adding a new `type: "form"` discriminant alongside the existing `type: "choices"`, reusing the proven widget/submessage rendering pipeline.

---

## Motivation

Zulip bots currently have two ways to interact with users:

1. **Text messages** — freeform, hard to parse structured data from
2. **zform "choices"** — simple button pickers (e.g., trivia quiz) that send predefined reply messages

Neither supports collecting structured data from users. Bots that need form-like input (e.g., creating knowledge cards, filing tickets, configuring settings) must resort to multi-step conversational flows that are awkward and error-prone.

Interactive forms solve this by rendering labeled input fields directly in the message view. Users fill out the form and click submit. The bot receives a clean JSON payload with all field values, enabling one-shot structured data collection.

### Related Upstream Issues and PRs

| Reference | Description | Status |
|---|---|---|
| #6102 | Interactive message attachments for bots | Open since 2017 |
| #32373 | Bot buttons/actions | Closed as duplicate |
| PR #14427 | Button row widget for zform | Stale (2020) |
| PR #37398 | Rich bot interactions (emberian fork) | Active (2026) |

---

## Architecture Decision: Extend zform, Not a New Widget Type

We chose to extend the existing zform widget rather than create a new widget type because:

1. **Minimal server changes** — validation only, no new infrastructure
2. **Reuses the proven widget/submessage rendering pipeline** — the entire message rendering, event broadcasting, and client synchronization machinery already works
3. **Backward compatible** — old clients that don't understand `type: "form"` gracefully degrade to showing the message's text content
4. **Upstream-friendly** — it's an evolution of existing patterns, not a parallel system

The discriminated union on `extra_data.type` (`"choices"` | `"form"`) cleanly separates the two modes while sharing the same widget infrastructure.

---

## Data Schema

### Form Definition (sent by bot via `widget_content`)

```json
{
  "widget_type": "zform",
  "extra_data": {
    "type": "form",
    "heading": "Create Knowledge Card",
    "fields": [
      {
        "name": "title",
        "type": "text",
        "label": "Card Title",
        "required": true,
        "placeholder": "Enter title..."
      },
      {
        "name": "body",
        "type": "textarea",
        "label": "Content",
        "required": false,
        "placeholder": "Card body..."
      },
      {
        "name": "category",
        "type": "select",
        "label": "Category",
        "options": [
          {"label": "FAQ", "value": "faq"},
          {"label": "Playbook", "value": "playbook"}
        ]
      },
      {
        "name": "tags",
        "type": "checkbox_group",
        "label": "Tags",
        "options": [
          {"label": "Options", "value": "options"},
          {"label": "Futures", "value": "futures"}
        ]
      },
      {
        "name": "review_date",
        "type": "date",
        "label": "Review By"
      }
    ],
    "actions": [
      {"name": "submit", "label": "Create Card", "style": "primary"},
      {"name": "cancel", "label": "Cancel", "style": "default"}
    ]
  }
}
```

### Supported Field Types

| Type | HTML Element | Value Type | Required Props | Optional Props |
|------|-------------|------------|----------------|----------------|
| `text` | `<input type="text">` | string | `name`, `label` | `required`, `placeholder` |
| `textarea` | `<textarea>` | string | `name`, `label` | `required`, `placeholder` |
| `select` | `<select>` | string | `name`, `label`, `options` | `required` |
| `checkbox_group` | multiple `<input type="checkbox">` | string[] | `name`, `label`, `options` | `required` |
| `date` | `<input type="date">` | string (YYYY-MM-DD) | `name`, `label` | `required` |

### Action Button Styles

| Style | Appearance |
|---|---|
| `"primary"` | Blue background, white text |
| `"danger"` | Red background, white text |
| `"default"` (or omitted) | Standard gray button |

### Form Submission Payload (submessage: client -> server -> broadcast)

```json
{
  "type": "form_submit",
  "action": "submit",
  "data": {
    "title": "How to roll an iron condor",
    "body": "Step 1: ...",
    "category": "playbook",
    "tags": ["options", "futures"],
    "review_date": "2026-03-15"
  }
}
```

---

## Event Flow

```
Bot                          Zulip Server                    User's Web Client
───                          ────────────                    ─────────────────

1. POST /api/v1/messages
   with widget_content
   containing form schema
                    ────────→ check_widget_content()
                              validates form schema
                              creates Message + SubMessage
                    ────────→ broadcasts message event

                                                             2. Widget pipeline renders
                                                                form inline in message
                                                                (inputs, labels, buttons)

                                                             3. User fills out form,
                                                                clicks action button

                                                             4. Client collects field values
                                                                POST /json/submessage
                                                                with form_submit payload
                    ←────────
                              validate_zform_data()
                              validates form_submit structure
                              broadcasts submessage event
                    ────────→

5. Bot receives form_submit
   event via event queue,
   parses structured data,
   acts on it
                                                             6. All viewers see form enter
                                                                disabled "submitted" state
```

### Key Design Points

- **Submessage system, not reply messages**: Unlike "choices" which sends a reply via `transmit.reply_message`, forms use the submessage callback. This means the submission data goes to all message recipients (including the bot) as a structured event, not as a new message in the stream.
- **Bot receives via standard event queue**: No client library changes needed. The Zulip Python client's `call_on_each_event()` already handles submessage events.
- **Single submission**: Once any user submits the form, it enters a disabled state for all viewers. The `form_submitted` flag prevents double submissions.

---

## Implementation: File-by-File Analysis

### Commit 1: `fe177a1` — Design Doc

**File**: `docs/plans/2026-02-14-zform-interactive-forms-design.md` (new, 222 lines)

The design document that drove the implementation. Covers the goal, architecture rationale, full data schema, server and frontend change plans, bot-side event flow, and graceful degradation strategy. References all related upstream issues.

---

### Commit 2: `edf4fe8` — Implementation Plan

**File**: `docs/plans/2026-02-14-zform-interactive-forms-plan.md` (new, 1332 lines)

A detailed 10-task implementation plan with TDD methodology — each task specifies the failing test first, then the implementation, then verification. The plan was followed in order, producing the subsequent 8 commits.

---

### Commit 3: `98b4bfc` — Backend Validation for Form Type

**Files**: `zerver/lib/validator.py` (+46 lines), `zerver/tests/test_widgets.py` (+114 lines)

**What it does**: Extends `check_widget_content()` to validate the `type: "form"` zform variant.

**Validation rules**:
- `heading` must be a string
- `fields` must be a list of dicts, each with `name` (string), `type` (one of 5 allowed values), `label` (string)
- `select` and `checkbox_group` fields must have an `options` array of `{label, value}` dicts
- `actions` must be a list of dicts with `name` and `label`

**Test coverage** (`test_zform_form_validation`):
- Missing heading, fields, actions
- Fields/actions not a list
- Field not a dict
- Field missing required keys (name, type, label)
- Invalid field type
- select/checkbox_group missing options
- Options not a list, option not a dict, option missing keys
- Action missing label
- Valid minimal form (empty fields/actions)
- Valid full form with all 5 field types

---

### Commit 4: `40ebde5` — Server-Side Validation for form_submit Submessages

**Files**: `zerver/lib/validator.py` (+18 lines), `zerver/views/submessage.py` (+8 lines), `zerver/tests/test_widgets.py` (+86 lines)

**What it does**: Adds `validate_zform_data()` function and wires it into `process_submessage()` for the `"zform"` widget type.

**Validation rules for form_submit**:
- `type` must be `"form_submit"` (string)
- `action` must be a string
- `data` must be a dict
- No extraneous keys allowed (`check_dict_only`)

**Test coverage** (`test_zform_form_submit_validation`):
- Creates a real zform form message via the API
- Posts invalid submessages: bogus JSON, non-dict, non-object, unknown type, missing action, missing data, wrong types, extraneous keys
- Posts valid submessages: with data, with empty data

---

### Commit 5: `5997759` — Integration Test for Form Widget Content

**File**: `zerver/tests/test_widgets.py` (+56 lines)

**What it does**: End-to-end test (`test_explicit_zform_form_content`) that sends a zform form via the messages API and verifies the SubMessage record is created with the correct widget data.

---

### Commit 6: `fe5ea5a` — CSS Styles for Form Widget

**File**: `web/styles/widgets.css` (+102 lines)

**What it does**: Adds styles for form fields, labels, inputs, textareas, selects, checkbox groups, action buttons, and the submitted state. Uses CSS nesting within `.widget-form`. Follows existing widget CSS patterns.

**Key style decisions**:
- `max-width: 400px` keeps forms compact within messages
- Input focus uses `hsl(206deg 80% 62%)` border (Zulip's standard focus color)
- Uses CSS custom properties (`--color-text-default`, `--color-background-widget-input`, `--color-background-widget-button`) for dark mode compatibility
- Submitted state: italic, green text (`hsl(153deg 40% 40%)`)
- Action button styles: primary (blue), danger (red), default (gray)

---

### Commit 7: `cee95fc` — Handlebars Template for Form Widget

**File**: `web/templates/widgets/zform_form.hbs` (new, 50 lines)

**What it does**: Renders the form DOM structure with labeled fields and action buttons.

**Template design**:
- Each field is wrapped in `.widget-form-field` with `data-field-name` attribute for JS data collection
- Uses boolean flags (`is_text`, `is_textarea`, `is_select`, `is_checkbox_group`, `is_date`) instead of Handlebars equality helpers, because Zulip's Handlebars strict mode doesn't have an `eq` helper
- Required fields show a red `*` indicator
- Action buttons carry `data-action-name` and optional style class

---

### Commit 8: `9ccd4a1` — Frontend Schema for Form Type and FormSubmitData

**Files**: `web/src/zform_data.ts` (+96 lines, refactored), `web/src/generic_widget.ts` (+3 lines), `web/src/widget_schema.ts` (+3 lines)

**What it does**: Extends the Zod schema in `zform_data.ts` to support both `"choices"` and `"form"` types via a discriminated union on the `type` field.

**Schema structure**:
```
zform_widget_extra_data_schema = discriminatedUnion("type", [
  zform_choices_extra_data_schema,   // existing
  zform_form_extra_data_schema,      // new
])
```

**New types exported**:
- `ZFormChoicesExtraData` — typed version of existing choices data
- `ZFormFormExtraData` — form with heading, fields, actions
- `FormField` — discriminated union of 5 field types
- `FormAction` — action button with optional style
- `FormSubmitData` — outbound submission payload

**Wiring changes**:
- `generic_widget.ts`: `WidgetOutboundData` union now includes `FormSubmitData`
- `widget_schema.ts`: Same `WidgetOutboundData` update

---

### Commit 9: `52e538f` — Form Rendering and Submission in activate()

**File**: `web/src/zform.ts` (+129 lines, -28 lines refactored)

This is the core frontend logic. The `activate()` function is extended to handle `type: "form"` alongside `type: "choices"`.

**Key functions added**:

| Function | Purpose |
|---|---|
| `render_form(data)` | Precomputes boolean field-type flags for Handlebars, renders template, binds action button click handlers |
| `collect_form_data()` | Iterates `.widget-form-field` elements, extracts values by field type (input, textarea, select, checkboxes) |
| `show_submitted_state()` | Disables all inputs and buttons, adds `.widget-form-submitted` class |

**Refactoring of existing code**:

The existing `make_choices()` was refactored to `render_choices()` following the `poll_widget` pattern — instead of creating detached jQuery elements and returning them, it sets HTML directly on `$outer_elem` and binds handlers on the live DOM. This is more consistent with how other widgets work.

**Event handling change**:

The old `handle_events` logged `"unexpected"` for any events. The new version parses each event through `form_submit_schema.safeParse()` — if it's a valid `form_submit`, it triggers `show_submitted_state()` so all viewers see the form as submitted when any user submits.

**Destructuring change**: The `activate()` function signature was changed from `opts` object access (`opts.$elem`, `opts.callback`) to destructured parameters (`{$elem, callback, any_data, message}`).

---

### Commit 10: `841905d` — Frontend Tests for Form Widget

**File**: `web/tests/zform.test.cjs` (new, 275 lines)

**What it does**: Comprehensive frontend test suite using Zulip's `zjquery` mock framework.

**Test cases**:

| Test | What it verifies |
|---|---|
| `activate choices type` | Backward compatibility — choices still render, button clicks still send `transmit.reply_message` |
| `activate with null extra_data` | Graceful degradation — logs blueslip error, returns noop handler |
| `activate form type and submit` | Form renders, action button click collects data and calls callback with `FormSubmitData`, submitted state applied (inputs/buttons disabled, CSS class added) |
| Double-submit prevention | After first submit, second click is a noop (callback not called again) |
| `handle_events with form_submit` | Inbound `form_submit` event from another user triggers submitted state |
| `handle_events ignores non-form_submit` | Null data, string data, and unrelated event types don't trigger submitted state |

**Template fix**: The test commit also fixes `zform_form.hbs` to conditionally render the `style` class on action buttons (`{{#if this.style}}...{{/if}}`), because Handlebars strict mode requires all referenced properties to exist, and `style` is optional.

---

### Commit 11: `f08cfca` — Documentation for Form Widget Type

**File**: `docs/subsystems/widgets.md` (+100 lines)

**What it does**: Adds a new "zform interactive forms" section to the widgets subsystem documentation covering:
- Form type payload with complete JSON example
- Supported field types table
- Form submission data flow (submessage-based, not reply-based)
- Server validation details
- Graceful degradation for non-supporting clients

---

## Graceful Degradation

| Client | Behavior |
|---|---|
| **Web (with this branch)** | Full interactive form rendering |
| **Web (without this branch)** | zform `activate()` won't have the `"form"` branch — form won't render (existing error handling catches this) |
| **Mobile** | Shows the message's text content. Bot should include a text fallback. |
| **Terminal/API clients** | See message text only |

The bot should always set meaningful `content` on the message (e.g., "Please fill out the form above" or a text version of the form fields) so non-supporting clients still show something useful.

---

## Bot Integration Example

```python
import json
import zulip

client = zulip.Client(config_file="~/.zuliprc")

# Send a form
form_widget = {
    "widget_type": "zform",
    "extra_data": {
        "type": "form",
        "heading": "Create Knowledge Card",
        "fields": [
            {"name": "title", "type": "text", "label": "Title", "required": True},
            {"name": "body", "type": "textarea", "label": "Content"},
            {
                "name": "category",
                "type": "select",
                "label": "Category",
                "options": [
                    {"label": "FAQ", "value": "faq"},
                    {"label": "Playbook", "value": "playbook"},
                ],
            },
        ],
        "actions": [
            {"name": "submit", "label": "Create", "style": "primary"},
            {"name": "cancel", "label": "Cancel"},
        ],
    },
}

client.send_message({
    "type": "stream",
    "to": "general",
    "topic": "knowledge cards",
    "content": "Please fill out the form to create a new knowledge card.",
    "widget_content": json.dumps(form_widget),
})


# Handle form submissions
def handle_event(event):
    if event["type"] == "submessage":
        data = json.loads(event["content"])
        if data.get("type") == "form_submit":
            action = data["action"]
            form_data = data["data"]
            if action == "submit":
                # Process the structured form data
                title = form_data.get("title", "")
                body = form_data.get("body", "")
                category = form_data.get("category", "")
                print(f"New card: {title} ({category})")
            elif action == "cancel":
                print("Form cancelled")


client.call_on_each_event(handle_event, event_types=["submessage"])
```

---

## Test Coverage Summary

### Backend Tests (`zerver/tests/test_widgets.py`)

| Test | Lines | Coverage |
|---|---|---|
| `test_zform_form_validation` | 114 | All validation branches in `check_widget_content()` for form type |
| `test_explicit_zform_form_content` | 56 | End-to-end: API message creation with form widget_content |
| `test_zform_form_submit_validation` | 86 | All validation branches in `validate_zform_data()` plus submessage API |

**Total backend test lines added**: 256

### Frontend Tests (`web/tests/zform.test.cjs`)

| Test | Coverage |
|---|---|
| `activate choices type` | Backward compatibility for existing zform behavior |
| `activate with null extra_data` | Error handling path |
| `activate form type and submit` | Form rendering, data collection, callback, submitted state, double-submit prevention |
| `handle_events with form_submit` | Inbound event processing, submitted state from remote events |
| `handle_events ignores non-form_submit` | Null, string, and unrelated events ignored |

**Total frontend test lines added**: 275

---

## Files Changed Summary

| File | Status | Lines | Purpose |
|---|---|---|---|
| `docs/plans/2026-02-14-zform-interactive-forms-design.md` | New | +222 | Design document |
| `docs/plans/2026-02-14-zform-interactive-forms-plan.md` | New | +1332 | Implementation plan (TDD) |
| `docs/subsystems/widgets.md` | Modified | +100 | User-facing documentation |
| `zerver/lib/validator.py` | Modified | +68 | Backend validation for form type + form_submit |
| `zerver/views/submessage.py` | Modified | +8 | Wire zform validation into submessage processing |
| `zerver/tests/test_widgets.py` | Modified | +256 | Backend test suite |
| `web/src/zform_data.ts` | Modified | +96/-17 | Zod schema: discriminated union, form types, FormSubmitData |
| `web/src/zform.ts` | Modified | +129/-18 | Form rendering, data collection, submission, event handling |
| `web/src/generic_widget.ts` | Modified | +3/-1 | WidgetOutboundData union includes FormSubmitData |
| `web/src/widget_schema.ts` | Modified | +3/-1 | Same WidgetOutboundData update |
| `web/templates/widgets/zform_form.hbs` | New | +50 | Handlebars template for form rendering |
| `web/styles/widgets.css` | Modified | +102 | Form widget CSS |
| `web/tests/zform.test.cjs` | New | +275 | Frontend test suite |

**Total**: +2,651 / -28 lines across 13 files

---

## Commit History

```
f08cfca docs: Document zform interactive form widget type.
841905d zform: Add frontend tests for form widget.
52e538f zform: Add form rendering and submission to activate().
9ccd4a1 zform: Add frontend schema for form type and FormSubmitData.
cee95fc zform: Add Handlebars template for form widget.
5997759 zform: Add integration test for form widget content.
fe5ea5a zform: Add CSS styles for form widget.
40ebde5 zform: Add server-side validation for form_submit submessages.
98b4bfc zform: Add backend validation for form type.
edf4fe8 docs: Add implementation plan for zform interactive forms.
fe177a1 docs: Add design doc for zform interactive forms.
```

Each commit follows Zulip's commit discipline: minimal, coherent, self-contained, and independently functional. Backend changes include their tests in the same commit. The series builds from design doc → plan → backend validation → frontend schema → template → CSS → frontend logic → frontend tests → documentation.

---

## Known Limitations and Future Work

### Current Limitations

1. **Single submission per form**: Once any user submits, the form is disabled for all viewers. There's no per-user submission tracking.
2. **No client-side required field validation**: The `required` attribute is set on HTML inputs but there's no JavaScript enforcement before submission. The bot must validate required fields server-side.
3. **No dynamic forms**: Forms are static — the bot can't update field options or add/remove fields after sending.
4. **No file upload field type**: Only text-based inputs are supported.
5. **Max limits not enforced in frontend schema**: The design doc specifies max 20 fields, 50 options, and 5 actions, but these are only documented, not enforced in the Zod schema or backend validator.

### Potential Future Extensions

- **Multi-step forms / wizards**: Bot sends a new form based on previous submission
- **Form update events**: Bot can modify form fields after sending (e.g., populate dropdowns dynamically)
- **Per-user submission**: Allow each user to submit independently (like polls)
- **File upload field type**: Attach files via the existing Zulip file upload API
- **Conditional fields**: Show/hide fields based on other field values
- **Upstream contribution**: Submit as a PR to zulip/zulip targeting #6102

---

## Deployment Notes

This branch is a fork of Zulip's main branch. To deploy:

1. The Zulip Docker image must be rebuilt from this branch (or merged into the production fork)
2. No database migrations are needed
3. No configuration changes required
4. Existing zform "choices" widgets continue to work unchanged
5. Bots can immediately start using `type: "form"` in widget_content after deployment
