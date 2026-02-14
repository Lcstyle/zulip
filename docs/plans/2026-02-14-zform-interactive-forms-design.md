# Interactive Forms for Zulip Bots (zform "form" type)

## Goal

Extend the existing zform widget system to support rich interactive forms — text inputs, textareas, dropdowns, checkboxes, and date pickers — that bots can send to users and receive structured form submissions via the submessage system. This is the first step toward closing the 8-year-old feature request for Slack-style interactive bot messages (issue #6102).

## Architecture

Extend zform's `extra_data.type` discriminant with a new `"form"` type alongside the existing `"choices"`. Forms render inline in messages (like polls) and submit data through the existing submessage system. The bot receives form submissions as submessage events through its standard event queue. No new models, migrations, or API endpoints required.

## Approach: Extend zform (not a new widget type)

We chose to extend the existing zform widget rather than create a new widget type because:

- Minimal server changes (validation only, no new infrastructure)
- Reuses the proven widget/submessage rendering pipeline
- Backward compatible — old clients that don't understand `type: "form"` gracefully degrade
- Upstream-friendly — it's an evolution of existing patterns, not a new system

## Data Schema

### Form Definition (bot sends via `widget_content` parameter)

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

### Field Types

| Type | HTML Element | Value Type | Required Props |
|------|-------------|------------|----------------|
| `text` | `<input type="text">` | string | `name`, `label` |
| `textarea` | `<textarea>` | string | `name`, `label` |
| `select` | `<select>` | string | `name`, `label`, `options` |
| `checkbox_group` | multiple `<input type="checkbox">` | string[] | `name`, `label`, `options` |
| `date` | `<input type="date">` | string (YYYY-MM-DD) | `name`, `label` |

### Optional Field Props

- `required` (boolean): client-side validation before submission
- `placeholder` (string): placeholder text for text/textarea fields

### Actions

Each action has:
- `name` (string): identifier sent in submission
- `label` (string): button text
- `style` (optional): `"primary"`, `"default"`, or `"danger"` — maps to CSS classes

### Limits

- Max 20 fields per form
- Max 50 options per select/checkbox_group
- Max 5 actions per form

### Form Submission (submessage: client -> server -> broadcast)

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

The submission flows through the existing `/json/submessage` endpoint. The server broadcasts the submessage event to all message recipients, including the bot (which is the message sender).

## Server-Side Changes

### `zerver/lib/validator.py`

Add validation for `type: "form"` inside the existing `check_widget_content()`:

- Validate `fields` array: each field has `name` (string), `type` (one of 5 allowed), `label` (string)
- Per-type validation: `select` and `checkbox_group` must have `options` array
- Validate `actions` array: each action has `name` and `label`
- Enforce max limits (20 fields, 50 options, 5 actions)

### `zerver/views/submessage.py`

Add validation for `type: "form_submit"` submessages when widget type is `zform`:

- Validate `action` is a string
- Validate `data` is a dict of string keys to string/array values
- No deep validation of field values against form schema (bot handles that)

### No Other Server Changes

- `zerver/lib/widget.py`: No changes — `do_widget_post_save_actions()` already handles arbitrary `extra_data` for zform
- No new models, no new API endpoints, no migrations

## Frontend Changes

### `web/src/zform_data.ts`

Extend the zod schema to support both `"choices"` and `"form"` via discriminated union on `type`.

### `web/src/zform.ts`

Extend the `activate()` function:

- Existing `render()` branches on `data.type === "choices"` — add `"form"` branch
- Form rendering: build DOM from fields array using the new template
- Submission handler: collect field values from DOM, build `form_submit` submessage, post via `callback` (submessage system, NOT `transmit.reply_message`)
- Post-submission: replace form with read-only "submitted" confirmation
- Handle inbound `form_submit` events: update to submitted state when another user/tab submits

### `web/templates/widgets/zform_form.hbs`

New Handlebars template for form rendering with labeled fields, inputs, and action buttons.

### `web/styles/widgets.css`

Minimal additions for form field layout (labels, inputs, spacing), consistent with existing widget styles.

### `web/src/widget_schema.ts`

Update the `zform_widget_extra_data_schema` reference to handle the new union type.

## Bot-Side Event Flow

1. Bot sends message with `widget_content` containing form definition
2. User fills out form, clicks action button
3. Client posts submessage to `/json/submessage` with `type: "form_submit"`
4. Server broadcasts submessage event to all message recipients (including bot)
5. Bot receives event through its Zulip event queue
6. Bot parses `form_submit` data and acts on it

Bot code example:

```python
def handle_submessage(event):
    data = json.loads(event["content"])
    if data.get("type") == "form_submit":
        action = data["action"]
        form_data = data["data"]
        # Process: create card, verify, etc.
```

No client library changes needed — the Zulip Python client already supports `submessage` events via `call_on_each_event()`.

## Graceful Degradation

- **Mobile/terminal clients**: see the message text content. Bot should include text fallback.
- **Old web clients**: zform `activate()` won't have the `"form"` branch — form won't render (existing error handling catches this).
- **Submitted state**: after submission, form renders read-only with submitted values visible to late-arriving users.

## Files Changed

| File | Change |
|------|--------|
| `zerver/lib/validator.py` | Add form validation in `check_widget_content()` |
| `zerver/views/submessage.py` | Add `form_submit` validation for zform widgets |
| `web/src/zform_data.ts` | Extend schema with form field/action types |
| `web/src/zform.ts` | Add form rendering, submission, and event handling |
| `web/templates/widgets/zform_form.hbs` | New template for form rendering |
| `web/styles/widgets.css` | Form field styling |
| `web/src/widget_schema.ts` | Update zform extra_data schema reference |
| `zerver/tests/test_widgets.py` | Backend tests for form validation |
| `web/tests/unit/zform.test.cjs` | Frontend tests for form widget |

## Related Issues

- #6102: Interactive message attachments for bots (2017, open)
- #32373: Bot buttons/actions (2024, closed as duplicate)
- PR #14427: Button row widget for zform (2020, stale)
- PR #37398: Rich bot interactions (2026, emberian fork)
