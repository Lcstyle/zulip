# Zform Interactive Forms Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the existing zform widget to support rich interactive forms (text, textarea, select, checkbox_group, date) with submissions routed through the submessage system.

**Architecture:** Add a new `type: "form"` discriminant to zform's `extra_data`, alongside the existing `type: "choices"`. Forms render inline in messages. Submissions are submessage events that the bot receives through its event queue. No new models, migrations, or API endpoints.

**Tech Stack:** Python/Django backend, TypeScript/jQuery/Handlebars frontend, Zod for schema validation, Zulip's existing widget/submessage infrastructure.

---

### Task 1: Backend validation for zform "form" type

**Files:**
- Modify: `zerver/lib/validator.py:424-471`
- Test: `zerver/tests/test_widgets.py`

**Step 1: Write the failing tests**

Add to `zerver/tests/test_widgets.py` inside the `WidgetContentTestCase` class, after the existing `test_validation` method:

```python
def test_zform_form_validation(self) -> None:
    def assert_error(obj: object, msg: str) -> None:
        with self.assertRaisesRegex(ValidationError, re.escape(msg)):
            check_widget_content(obj)

    # Basic form structure validation
    extra_data: dict[str, Any] = {"type": "form"}
    obj = dict(widget_type="zform", extra_data=extra_data)

    assert_error(obj, "heading key is missing from extra_data")

    extra_data["heading"] = "Create Card"
    assert_error(obj, "fields key is missing from extra_data")

    extra_data["fields"] = "not a list"
    assert_error(obj, 'extra_data["fields"] is not a list')

    extra_data["fields"] = [99]
    assert_error(obj, 'extra_data["fields"][0] is not a dict')

    # Field missing required keys
    extra_data["fields"] = [{"name": "title"}]
    assert_error(obj, 'type key is missing from extra_data["fields"][0]')

    extra_data["fields"] = [{"name": "title", "type": "text"}]
    assert_error(obj, 'label key is missing from extra_data["fields"][0]')

    # Unknown field type
    extra_data["fields"] = [{"name": "title", "type": "bogus", "label": "Title"}]
    assert_error(obj, "unknown form field type: bogus")

    # Select missing options
    extra_data["fields"] = [{"name": "cat", "type": "select", "label": "Category"}]
    assert_error(obj, 'options key is missing from extra_data["fields"][0]')

    # checkbox_group missing options
    extra_data["fields"] = [{"name": "tags", "type": "checkbox_group", "label": "Tags"}]
    assert_error(obj, 'options key is missing from extra_data["fields"][0]')

    # actions validation
    extra_data["fields"] = [{"name": "title", "type": "text", "label": "Title"}]
    assert_error(obj, "actions key is missing from extra_data")

    extra_data["actions"] = "not a list"
    assert_error(obj, 'extra_data["actions"] is not a list')

    extra_data["actions"] = [{"name": "submit"}]
    assert_error(obj, 'label key is missing from extra_data["actions"][0]')

    # Valid minimal form
    extra_data["actions"] = [{"name": "submit", "label": "Submit"}]
    check_widget_content(obj)

    # Valid full form with all field types
    full_form = dict(
        widget_type="zform",
        extra_data=dict(
            type="form",
            heading="Create Knowledge Card",
            fields=[
                dict(name="title", type="text", label="Card Title"),
                dict(name="body", type="textarea", label="Content"),
                dict(
                    name="category",
                    type="select",
                    label="Category",
                    options=[
                        dict(label="FAQ", value="faq"),
                        dict(label="Playbook", value="playbook"),
                    ],
                ),
                dict(
                    name="tags",
                    type="checkbox_group",
                    label="Tags",
                    options=[
                        dict(label="Options", value="options"),
                        dict(label="Futures", value="futures"),
                    ],
                ),
                dict(name="review_date", type="date", label="Review By"),
            ],
            actions=[
                dict(name="submit", label="Create Card"),
                dict(name="cancel", label="Cancel"),
            ],
        ),
    )
    check_widget_content(full_form)
```

**Step 2: Run test to verify it fails**

Run: `./tools/test-backend zerver.tests.test_widgets.WidgetContentTestCase.test_zform_form_validation -v`
Expected: FAIL — `"unknown zform type: form"` because the validator doesn't know about `type: "form"` yet.

**Step 3: Implement form validation**

In `zerver/lib/validator.py`, find the `check_widget_content` function (line 424). Replace the block starting at line 440 (`if widget_type == "zform":`) through line 471 with:

```python
    if widget_type == "zform":
        if "type" not in extra_data:
            raise ValidationError("zform is missing type field")

        if extra_data["type"] == "choices":
            check_choices = check_list(
                check_dict(
                    [
                        ("short_name", check_string),
                        ("long_name", check_string),
                        ("reply", check_string),
                    ]
                ),
            )

            checker = check_dict(
                [
                    ("type", equals("choices")),
                    ("heading", check_string),
                    ("choices", check_choices),
                ]
            )

            checker("extra_data", extra_data)

            return widget_content

        if extra_data["type"] == "form":
            valid_field_types = ["text", "textarea", "select", "checkbox_group", "date"]

            check_option = check_dict(
                [
                    ("label", check_string),
                    ("value", check_string),
                ]
            )

            def check_form_field(var_name: str, field: object) -> None:
                if not isinstance(field, dict):
                    raise ValidationError(f'{var_name} is not a dict')

                for key in ["name", "type", "label"]:
                    if key not in field:
                        raise ValidationError(f'{key} key is missing from {var_name}')

                if not isinstance(field["name"], str):
                    raise ValidationError(f'{var_name}["name"] is not a string')
                if not isinstance(field["type"], str):
                    raise ValidationError(f'{var_name}["type"] is not a string')
                if not isinstance(field["label"], str):
                    raise ValidationError(f'{var_name}["label"] is not a string')

                if field["type"] not in valid_field_types:
                    raise ValidationError(f"unknown form field type: {field['type']}")

                if field["type"] in ("select", "checkbox_group"):
                    if "options" not in field:
                        raise ValidationError(f'options key is missing from {var_name}')
                    check_list(check_option)(f'{var_name}["options"]', field["options"])

            check_action = check_dict(
                [
                    ("name", check_string),
                    ("label", check_string),
                ]
            )

            # Validate top-level structure
            if "heading" not in extra_data:
                raise ValidationError("heading key is missing from extra_data")
            check_string("heading", extra_data["heading"])

            if "fields" not in extra_data:
                raise ValidationError("fields key is missing from extra_data")
            if not isinstance(extra_data["fields"], list):
                raise ValidationError('extra_data["fields"] is not a list')

            for i, field in enumerate(extra_data["fields"]):
                check_form_field(f'extra_data["fields"][{i}]', field)

            if "actions" not in extra_data:
                raise ValidationError("actions key is missing from extra_data")
            check_list(check_action)("extra_data[\"actions\"]", extra_data["actions"])

            return widget_content

        raise ValidationError("unknown zform type: " + extra_data["type"])

    raise ValidationError("unknown widget type: " + widget_type)
```

**Step 4: Run test to verify it passes**

Run: `./tools/test-backend zerver.tests.test_widgets.WidgetContentTestCase.test_zform_form_validation -v`
Expected: PASS

**Step 5: Run the full widget test suite to check nothing is broken**

Run: `./tools/test-backend zerver.tests.test_widgets -v`
Expected: All existing tests PASS

**Step 6: Lint**

Run: `./tools/lint zerver/lib/validator.py zerver/tests/test_widgets.py`
Expected: PASS

**Step 7: Commit**

```bash
git add zerver/lib/validator.py zerver/tests/test_widgets.py
git commit -m "zform: Add backend validation for form type.

Extend check_widget_content() to validate a new 'form' type for the
zform widget. Forms support text, textarea, select, checkbox_group,
and date field types with labeled actions. Select and checkbox_group
fields require an options array.

Fixes part of #6102."
```

---

### Task 2: Backend validation for form_submit submessages

**Files:**
- Modify: `zerver/lib/validator.py` (add `validate_zform_data`)
- Modify: `zerver/views/submessage.py:21-65`
- Test: `zerver/tests/test_widgets.py`

**Step 1: Write the failing tests**

Add to `zerver/tests/test_widgets.py`:

```python
def test_zform_form_submit_validation(self) -> None:
    sender = self.example_user("cordelia")
    stream_name = "Verona"
    content = "Fill out this form"

    form_data = dict(
        type="form",
        heading="Create Card",
        fields=[
            dict(name="title", type="text", label="Title"),
        ],
        actions=[
            dict(name="submit", label="Submit"),
        ],
    )

    widget_content = dict(
        widget_type="zform",
        extra_data=form_data,
    )

    payload = dict(
        type="stream",
        to=orjson.dumps(stream_name).decode(),
        topic="whatever",
        content=content,
        widget_content=orjson.dumps(widget_content).decode(),
    )
    result = self.api_post(sender, "/api/v1/messages", payload)
    self.assert_json_success(result)

    message = self.get_last_message()

    def post_submessage(content: str) -> "TestHttpResponse":
        payload = dict(
            message_id=message.id,
            msg_type="widget",
            content=content,
        )
        return self.api_post(sender, "/api/v1/submessage", payload)

    def assert_error(content: str, error: str) -> None:
        result = post_submessage(content)
        self.assert_json_error_contains(result, error)

    # Invalid form_submit data
    assert_error('{"type": "form_submit"}', "action key is missing")
    assert_error(
        '{"type": "form_submit", "action": 123}',
        "not a string",
    )
    assert_error(
        '{"type": "form_submit", "action": "submit"}',
        "data key is missing",
    )
    assert_error(
        '{"type": "form_submit", "action": "submit", "data": "not a dict"}',
        "not a dict",
    )

    # Valid form_submit
    valid_submit = dict(
        type="form_submit",
        action="submit",
        data=dict(title="My Card"),
    )
    result = post_submessage(orjson.dumps(valid_submit).decode())
    self.assert_json_success(result)
```

**Step 2: Run test to verify it fails**

Run: `./tools/test-backend zerver.tests.test_widgets.WidgetContentTestCase.test_zform_form_submit_validation -v`
Expected: FAIL — the `form_submit` type is not yet validated, and no zform validation exists in `process_submessage`.

**Step 3: Add validate_zform_data to validator.py**

At the end of `zerver/lib/validator.py` (after `validate_todo_data`), add:

```python
def validate_zform_data(zform_data: object, is_widget_author: bool) -> None:
    check_dict([("type", check_string)])("zform data", zform_data)

    assert isinstance(zform_data, dict)

    if zform_data["type"] == "form_submit":
        if "action" not in zform_data:
            raise ValidationError("action key is missing from zform data")
        check_string("action", zform_data["action"])

        if "data" not in zform_data:
            raise ValidationError("data key is missing from zform data")
        if not isinstance(zform_data["data"], dict):
            raise ValidationError('zform data["data"] is not a dict')

        return

    raise ValidationError(f"Unknown type for zform data: {zform_data['type']}")
```

**Step 4: Wire validate_zform_data into process_submessage**

In `zerver/views/submessage.py`, add the import:

```python
from zerver.lib.validator import validate_poll_data, validate_todo_data, validate_zform_data
```

Then after the `if widget_type == "todo":` block (around line 56), add:

```python
    if widget_type == "zform":
        try:
            validate_zform_data(zform_data=widget_data, is_widget_author=is_widget_author)
        except ValidationError as error:
            raise JsonableError(error.message)
```

**Step 5: Run test to verify it passes**

Run: `./tools/test-backend zerver.tests.test_widgets.WidgetContentTestCase.test_zform_form_submit_validation -v`
Expected: PASS

**Step 6: Run full test suite**

Run: `./tools/test-backend zerver.tests.test_widgets -v`
Expected: All tests PASS

**Step 7: Lint**

Run: `./tools/lint zerver/lib/validator.py zerver/views/submessage.py zerver/tests/test_widgets.py`
Expected: PASS

**Step 8: Commit**

```bash
git add zerver/lib/validator.py zerver/views/submessage.py zerver/tests/test_widgets.py
git commit -m "zform: Add server-side validation for form_submit submessages.

When users submit a zform interactive form, the submission data is
sent as a submessage with type 'form_submit'. Add validate_zform_data()
to validate the structure and wire it into process_submessage() for
the zform widget type.

Fixes part of #6102."
```

---

### Task 3: Backend integration test — send form widget via API

**Files:**
- Test: `zerver/tests/test_widgets.py`

**Step 1: Write the test**

Add to `zerver/tests/test_widgets.py`:

```python
def test_explicit_zform_form_content(self) -> None:
    """Test sending a zform form widget via the API and verifying
    the submessage is created correctly."""
    sender = self.example_user("cordelia")
    stream_name = "Verona"
    content = "Please fill out this form"

    form_data = dict(
        type="form",
        heading="Create Knowledge Card",
        fields=[
            dict(name="title", type="text", label="Card Title"),
            dict(
                name="category",
                type="select",
                label="Category",
                options=[
                    dict(label="FAQ", value="faq"),
                    dict(label="Playbook", value="playbook"),
                ],
            ),
        ],
        actions=[
            dict(name="submit", label="Create Card"),
        ],
    )

    widget_content = dict(
        widget_type="zform",
        extra_data=form_data,
    )

    payload = dict(
        type="stream",
        to=orjson.dumps(stream_name).decode(),
        topic="whatever",
        content=content,
        widget_content=orjson.dumps(widget_content).decode(),
    )
    result = self.api_post(sender, "/api/v1/messages", payload)
    self.assert_json_success(result)

    message = self.get_last_message()
    self.assertEqual(message.content, content)

    expected_submessage_content = dict(
        widget_type="zform",
        extra_data=form_data,
    )

    submessage = SubMessage.objects.get(message_id=message.id)
    self.assertEqual(submessage.msg_type, "widget")
    self.assertEqual(orjson.loads(submessage.content), expected_submessage_content)
```

**Step 2: Run test**

Run: `./tools/test-backend zerver.tests.test_widgets.WidgetContentTestCase.test_explicit_zform_form_content -v`
Expected: PASS (this should already work since Task 1 added the validation).

**Step 3: Run full suite and lint**

Run: `./tools/test-backend zerver.tests.test_widgets -v && ./tools/lint zerver/tests/test_widgets.py`
Expected: All PASS

**Step 4: Commit**

```bash
git add zerver/tests/test_widgets.py
git commit -m "zform: Add integration test for form widget creation via API.

Verify that sending a message with widget_content containing a zform
form correctly creates the SubMessage record with the form data.

Fixes part of #6102."
```

---

### Task 4: Frontend schema — extend zform_data.ts

**Files:**
- Modify: `web/src/zform_data.ts`
- Modify: `web/src/widget_schema.ts`

**Step 1: Rewrite zform_data.ts with discriminated union**

Replace the contents of `web/src/zform_data.ts` with:

```typescript
import * as z from "zod/mini";

/*
    The zform widget supports two types:

    1. "choices" - Original button-based form for simple bot interactions
       (e.g., trivia quiz bot). Buttons send predefined message replies.

    2. "form" - Rich interactive form with text inputs, textareas, selects,
       checkbox groups, and date pickers. Submissions are sent as submessages
       so bots can receive structured form data.

    See docs/subsystems/widgets.md for details.
*/

// --- Choices type (existing) ---

const zform_choice_schema = z.object({
    type: z.string(),
    long_name: z.string(),
    reply: z.string(),
    short_name: z.string(),
});

const zform_choices_extra_data_schema = z.object({
    type: z.literal("choices"),
    heading: z.string(),
    choices: z.array(zform_choice_schema),
});

export type ZFormChoicesExtraData = z.infer<typeof zform_choices_extra_data_schema>;

// --- Form type (new) ---

const form_option_schema = z.object({
    label: z.string(),
    value: z.string(),
});

const form_field_text_schema = z.object({
    type: z.literal("text"),
    name: z.string(),
    label: z.string(),
    required: z.optional(z.boolean()),
    placeholder: z.optional(z.string()),
});

const form_field_textarea_schema = z.object({
    type: z.literal("textarea"),
    name: z.string(),
    label: z.string(),
    required: z.optional(z.boolean()),
    placeholder: z.optional(z.string()),
});

const form_field_select_schema = z.object({
    type: z.literal("select"),
    name: z.string(),
    label: z.string(),
    options: z.array(form_option_schema),
});

const form_field_checkbox_group_schema = z.object({
    type: z.literal("checkbox_group"),
    name: z.string(),
    label: z.string(),
    options: z.array(form_option_schema),
});

const form_field_date_schema = z.object({
    type: z.literal("date"),
    name: z.string(),
    label: z.string(),
    required: z.optional(z.boolean()),
});

export const form_field_schema = z.discriminatedUnion("type", [
    form_field_text_schema,
    form_field_textarea_schema,
    form_field_select_schema,
    form_field_checkbox_group_schema,
    form_field_date_schema,
]);

export type FormField = z.infer<typeof form_field_schema>;

const form_action_schema = z.object({
    name: z.string(),
    label: z.string(),
    style: z.optional(z.string()),
});

export type FormAction = z.infer<typeof form_action_schema>;

const zform_form_extra_data_schema = z.object({
    type: z.literal("form"),
    heading: z.string(),
    fields: z.array(form_field_schema),
    actions: z.array(form_action_schema),
});

export type ZFormFormExtraData = z.infer<typeof zform_form_extra_data_schema>;

// --- Combined schema ---

export const zform_widget_extra_data_schema = z.discriminatedUnion("type", [
    zform_choices_extra_data_schema,
    zform_form_extra_data_schema,
]);

export type ZFormExtraData = z.infer<typeof zform_widget_extra_data_schema>;

// --- Form submission submessage ---

export const form_submit_schema = z.object({
    type: z.literal("form_submit"),
    action: z.string(),
    data: z.record(z.string(), z.unknown()),
});

export type FormSubmitData = z.infer<typeof form_submit_schema>;
```

**Step 2: Verify widget_schema.ts still compiles**

`web/src/widget_schema.ts` imports `zform_widget_extra_data_schema` from `zform_data.ts` — the export name hasn't changed, so it should still work. Verify by checking the import:

Run: `./tools/lint web/src/zform_data.ts web/src/widget_schema.ts`
Expected: PASS (or type errors that we fix)

**Step 3: Commit**

```bash
git add web/src/zform_data.ts
git commit -m "zform: Extend frontend schema with form field types.

Add Zod schemas for the new 'form' type in zform widgets, including
text, textarea, select, checkbox_group, and date field types, plus
form actions and form_submit submessage data.

The existing 'choices' type is preserved via a discriminated union
on the 'type' field.

Fixes part of #6102."
```

---

### Task 5: Frontend template — zform_form.hbs

**Files:**
- Create: `web/templates/widgets/zform_form.hbs`

**Step 1: Create the template**

```handlebars
<div class="widget-form">
    <div class="widget-form-heading">{{ heading }}</div>
    <div class="widget-form-fields">
        {{#each fields}}
            <div class="widget-form-field" data-field-name="{{ this.name }}">
                <label class="widget-form-label">
                    {{ this.label }}
                    {{#if this.required}}<span class="widget-form-required">*</span>{{/if}}
                </label>
                {{#if (eq this.type "text")}}
                    <input type="text" class="widget-form-input" name="{{ this.name }}"
                        {{#if this.placeholder}}placeholder="{{ this.placeholder }}"{{/if}}
                        {{#if this.required}}required{{/if}} />
                {{/if}}
                {{#if (eq this.type "textarea")}}
                    <textarea class="widget-form-textarea" name="{{ this.name }}" rows="4"
                        {{#if this.placeholder}}placeholder="{{ this.placeholder }}"{{/if}}
                        {{#if this.required}}required{{/if}}></textarea>
                {{/if}}
                {{#if (eq this.type "select")}}
                    <select class="widget-form-select" name="{{ this.name }}">
                        {{#each this.options}}
                            <option value="{{ this.value }}">{{ this.label }}</option>
                        {{/each}}
                    </select>
                {{/if}}
                {{#if (eq this.type "checkbox_group")}}
                    <div class="widget-form-checkbox-group">
                        {{#each this.options}}
                            <label class="widget-form-checkbox-label">
                                <input type="checkbox" name="{{ ../name }}" value="{{ this.value }}" />
                                {{ this.label }}
                            </label>
                        {{/each}}
                    </div>
                {{/if}}
                {{#if (eq this.type "date")}}
                    <input type="date" class="widget-form-input" name="{{ this.name }}"
                        {{#if this.required}}required{{/if}} />
                {{/if}}
            </div>
        {{/each}}
    </div>
    <div class="widget-form-actions">
        {{#each actions}}
            <button class="widget-form-action widget-form-action-{{ this.style }}"
                data-action-name="{{ this.name }}">{{ this.label }}</button>
        {{/each}}
    </div>
</div>
```

**Note:** Zulip uses a custom Handlebars helper `eq` for comparisons. Check if it exists by running `git grep "registerHelper.*eq" -- web/` — if it doesn't exist, register it or use a different approach (nested `{{#if}}` with precomputed booleans). The implementer should verify this and adjust accordingly.

**Step 2: Commit**

```bash
git add web/templates/widgets/zform_form.hbs
git commit -m "zform: Add Handlebars template for form rendering.

New template renders form fields (text, textarea, select,
checkbox_group, date) with labels and action buttons. Each field
and action has data attributes for JS event binding.

Fixes part of #6102."
```

---

### Task 6: Frontend CSS — form widget styles

**Files:**
- Modify: `web/styles/widgets.css`

**Step 1: Add form widget styles**

Append to `web/styles/widgets.css`:

```css
/* Interactive form widget */
.widget-form {
    max-width: 400px;

    .widget-form-heading {
        font-weight: 600;
        margin-bottom: 8px;
    }

    .widget-form-field {
        margin-bottom: 8px;
    }

    .widget-form-label {
        display: block;
        font-weight: 500;
        margin-bottom: 2px;
        font-size: 0.9285em; /* 13px at 14px/em */
    }

    .widget-form-required {
        color: hsl(0deg 80% 50%);
    }

    .widget-form-input,
    .widget-form-textarea,
    .widget-form-select {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid hsl(0deg 0% 80%);
        box-shadow: inset 0 1px 1px hsl(0deg 0% 0% / 7.5%);
        border-radius: 4px;
        padding: 4px 6px;
        color: var(--color-text-default);
        font-family: inherit;
        font-size: inherit;
        background-color: var(--color-background-widget-input, transparent);

        &:focus {
            border-color: hsl(206deg 80% 62%);
            outline: 0;
        }
    }

    .widget-form-textarea {
        resize: vertical;
        min-height: 60px;
    }

    .widget-form-checkbox-group {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
    }

    .widget-form-checkbox-label {
        display: flex;
        align-items: center;
        gap: 4px;
        font-weight: normal;
        cursor: pointer;
    }

    .widget-form-actions {
        display: flex;
        gap: 6px;
        margin-top: 10px;
    }

    .widget-form-action {
        border-radius: 3px;
        padding: 4px 14px;
        font-family: inherit;
        font-size: inherit;
        cursor: pointer;
        border: 1px solid hsl(0deg 0% 80%);
        background-color: var(--color-background-widget-button, hsl(0deg 0% 95%));
        color: var(--color-text-default);
    }

    .widget-form-action-primary {
        background-color: hsl(207deg 56% 48%);
        border-color: hsl(207deg 56% 48%);
        color: hsl(0deg 0% 100%);
    }

    .widget-form-action-danger {
        background-color: hsl(0deg 56% 48%);
        border-color: hsl(0deg 56% 48%);
        color: hsl(0deg 0% 100%);
    }

    .widget-form-submitted {
        font-style: italic;
        color: hsl(153deg 40% 40%);
        padding: 4px 0;
    }
}
```

**Step 2: Lint**

Run: `./tools/lint web/styles/widgets.css`
Expected: PASS

**Step 3: Commit**

```bash
git add web/styles/widgets.css
git commit -m "zform: Add CSS styles for form widget.

Style form fields, labels, actions, and submitted state. Uses
existing widget CSS variable patterns for theming compatibility.

Fixes part of #6102."
```

---

### Task 7: Frontend logic — extend zform.ts activate()

**Files:**
- Modify: `web/src/zform.ts`

**Step 1: Implement the form rendering and submission logic**

Replace `web/src/zform.ts` with:

```typescript
import $ from "jquery";
import assert from "minimalistic-assert";

import render_widgets_zform_choices from "../templates/widgets/zform_choices.hbs";
import render_widgets_zform_form from "../templates/widgets/zform_form.hbs";

import * as blueslip from "./blueslip.ts";
import type {Message} from "./message_store.ts";
import * as transmit from "./transmit.ts";
import type {Event} from "./widget_data.ts";
import type {AnyWidgetData} from "./widget_schema.ts";
import type {ZFormChoicesExtraData, ZFormFormExtraData} from "./zform_data.ts";
import {form_submit_schema} from "./zform_data.ts";

export const widget_type = "zform";

export function activate(opts: {
    $elem: JQuery;
    callback: (data: {type: string; action: string; data: Record<string, unknown>}) => void;
    any_data: AnyWidgetData;
    message: Message;
}): (events: Event[]) => void {
    assert(opts.any_data.widget_type === "zform");
    const $outer_elem = opts.$elem;
    if (opts.any_data.extra_data === null) {
        blueslip.error("invalid zform extra data");
        return (_events: Event[]): void => {
            /* noop */
        };
    }
    const data = opts.any_data.extra_data;

    let form_submitted = false;

    function make_choices(data: ZFormChoicesExtraData): JQuery {
        const data_with_choices_with_idx = {
            ...data,
            choices: data.choices.map((choice, idx) => ({...choice, idx})),
        };

        const html = render_widgets_zform_choices(data_with_choices_with_idx);
        const $elem = $(html);

        $elem.find("button").on("click", (e) => {
            e.stopPropagation();

            const idx = Number.parseInt($(e.target).attr("data-idx")!, 10);
            const reply_content = data.choices[idx]!.reply;

            transmit.reply_message(opts.message, reply_content);
        });

        return $elem;
    }

    function collect_form_data($form: JQuery): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        const form_data = data as ZFormFormExtraData;

        for (const field of form_data.fields) {
            if (field.type === "checkbox_group") {
                const checked: string[] = [];
                $form
                    .find(`input[name="${CSS.escape(field.name)}"]:checked`)
                    .each(function () {
                        checked.push($(this).val() as string);
                    });
                result[field.name] = checked;
            } else if (field.type === "textarea") {
                result[field.name] =
                    $form.find(`textarea[name="${CSS.escape(field.name)}"]`).val() ?? "";
            } else {
                result[field.name] =
                    $form
                        .find(
                            `input[name="${CSS.escape(field.name)}"], select[name="${CSS.escape(field.name)}"]`,
                        )
                        .val() ?? "";
            }
        }

        return result;
    }

    function show_submitted($form: JQuery, action_name: string): void {
        form_submitted = true;
        $form.find(".widget-form-fields, .widget-form-actions").remove();
        $form.append(
            $("<div>")
                .addClass("widget-form-submitted")
                .text(`Form submitted (${action_name}).`),
        );
    }

    function make_form(data: ZFormFormExtraData): JQuery {
        const html = render_widgets_zform_form(data);
        const $elem = $(html);

        $elem.find(".widget-form-action").on("click", (e) => {
            e.stopPropagation();

            if (form_submitted) {
                return;
            }

            const action_name = $(e.target).attr("data-action-name")!;
            const form_values = collect_form_data($elem);

            opts.callback({
                type: "form_submit",
                action: action_name,
                data: form_values,
            });

            show_submitted($elem, action_name);
        });

        return $elem;
    }

    function render(): void {
        if (data.type === "choices") {
            $outer_elem.html(make_choices(data as ZFormChoicesExtraData).html());
        } else if (data.type === "form") {
            if (form_submitted) {
                return;
            }
            $outer_elem.html(make_form(data as ZFormFormExtraData).html());
        }
    }

    const handle_events = function (events: Event[]): void {
        for (const event of events) {
            if (typeof event.data === "object" && event.data !== null) {
                const parsed = form_submit_schema.safeParse(event.data);
                if (parsed.success) {
                    form_submitted = true;
                }
            }
        }
        render();
    };

    render();

    return handle_events;
}
```

**Key changes from original:**
1. Import `callback` parameter (was unused by choices — now used by forms for submessage posting)
2. New `make_form()` function parallel to `make_choices()`
3. `collect_form_data()` gathers values from DOM inputs
4. `show_submitted()` replaces form with confirmation
5. `handle_events()` now processes `form_submit` events to update submitted state
6. `render()` branches on `data.type === "form"`

**Step 2: Update generic_widget.ts WidgetOutboundData type**

The `WidgetOutboundData` type in `generic_widget.ts` (line 12) needs to include the form submit type. Add to the union:

In `web/src/generic_widget.ts`, update the `WidgetOutboundData` type and the `WidgetImplementation` type. The form submit data has a different shape than poll/todo outbound data, so we need to widen the type.

Modify `web/src/generic_widget.ts` line 12:

```typescript
import type {FormSubmitData} from "./zform_data.ts";

type WidgetOutboundData = PollWidgetOutboundData | TodoWidgetOutboundData | FormSubmitData;
```

And in `web/src/widget_schema.ts` line 17, add to the `WidgetOutboundData` type:

```typescript
import type {FormSubmitData} from "./zform_data.ts";

export type WidgetOutboundData = PollWidgetOutboundData | TodoWidgetOutboundData | FormSubmitData;
```

**Step 3: Lint**

Run: `./tools/lint web/src/zform.ts web/src/zform_data.ts web/src/generic_widget.ts web/src/widget_schema.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add web/src/zform.ts web/src/generic_widget.ts web/src/widget_schema.ts
git commit -m "zform: Implement form rendering and submission in web client.

Extend zform.ts activate() to handle the new 'form' type alongside
'choices'. Forms render labeled inputs (text, textarea, select,
checkbox_group, date) and action buttons. On submission, form data
is collected from the DOM and sent as a submessage via the callback,
so the bot receives it through the event queue.

After submission, the form is replaced with a confirmation message.
Inbound form_submit events from other users/tabs update the state.

Fixes part of #6102."
```

---

### Task 8: Frontend tests — zform form widget

**Files:**
- Create or modify: `web/tests/zform.test.cjs` (check if this exists; if not, create it)

**Step 1: Check for existing test file**

Run: `ls web/tests/zform*` — if no file exists, create `web/tests/zform.test.cjs`.

**Step 2: Write the tests**

```javascript
"use strict";

const assert = require("node:assert/strict");

const {mock_esm, zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");
const {mock_template} = require("./lib/template.cjs");

const transmit = mock_esm("../src/transmit.ts");

const zform = zrequire("zform");

run_test("activate choices (existing behavior)", ({override}) => {
    let reply_content;
    override(transmit, "reply_message", (_msg, content) => {
        reply_content = content;
    });

    const $elem = $.create("zform choices");
    const any_data = {
        widget_type: "zform",
        extra_data: {
            type: "choices",
            heading: "Pick one",
            choices: [
                {type: "multiple_choice", short_name: "A", long_name: "Option A", reply: "answer A"},
                {type: "multiple_choice", short_name: "B", long_name: "Option B", reply: "answer B"},
            ],
        },
    };

    const message = {id: 100, sender_id: 1};
    const callback = () => {};

    const handle_events = zform.activate({$elem, callback, any_data, message});
    assert.ok($elem.html().includes("Pick one"));

    // Simulate button click
    const $button = $elem.find("button[data-idx='1']");
    $button.trigger("click");
    assert.equal(reply_content, "answer B");

    // Events should be handled without error
    handle_events([]);
});

run_test("activate form", () => {
    let submitted_data;
    const callback = (data) => {
        submitted_data = data;
    };

    const $elem = $.create("zform form");
    const any_data = {
        widget_type: "zform",
        extra_data: {
            type: "form",
            heading: "Create Card",
            fields: [
                {type: "text", name: "title", label: "Title", required: true},
                {
                    type: "select",
                    name: "category",
                    label: "Category",
                    options: [
                        {label: "FAQ", value: "faq"},
                        {label: "Playbook", value: "playbook"},
                    ],
                },
            ],
            actions: [{name: "submit", label: "Create", style: "primary"}],
        },
    };

    const message = {id: 200, sender_id: 1};

    const handle_events = zform.activate({$elem, callback, any_data, message});
    assert.ok($elem.html().includes("Create Card"));
    assert.ok($elem.html().includes("Title"));

    // Simulate filling form and clicking submit
    $elem.find('input[name="title"]').val("My Card");
    $elem.find('select[name="category"]').val("playbook");

    const $submit = $elem.find('button[data-action-name="submit"]');
    $submit.trigger("click");

    assert.deepStrictEqual(submitted_data, {
        type: "form_submit",
        action: "submit",
        data: {
            title: "My Card",
            category: "playbook",
        },
    });

    // After submission, form should show submitted state
    assert.ok($elem.html().includes("submitted"));
});

run_test("activate form - handle inbound form_submit event", () => {
    const callback = () => {};
    const $elem = $.create("zform form events");
    const any_data = {
        widget_type: "zform",
        extra_data: {
            type: "form",
            heading: "Test Form",
            fields: [{type: "text", name: "title", label: "Title"}],
            actions: [{name: "submit", label: "Go"}],
        },
    };

    const message = {id: 300, sender_id: 1};

    const handle_events = zform.activate({$elem, callback, any_data, message});

    // Simulate inbound form_submit event from another user
    handle_events([
        {
            sender_id: 2,
            data: {
                type: "form_submit",
                action: "submit",
                data: {title: "Their Card"},
            },
        },
    ]);

    // Form should now show submitted state
    assert.ok($elem.html().includes("submitted") || $elem.html().includes("Form submitted"));
});

run_test("activate form - null extra_data", () => {
    const $elem = $.create("zform null");
    const any_data = {
        widget_type: "zform",
        extra_data: null,
    };

    const message = {id: 400, sender_id: 1};
    const callback = () => {};

    // Should not throw
    const handle_events = zform.activate({$elem, callback, any_data, message});
    handle_events([]);
});
```

**Note:** Zulip's frontend test infrastructure uses a custom jQuery mock. The implementer should check `web/tests/lib/` for the jQuery mock capabilities and adjust selectors/assertions accordingly. The test structure above follows the `poll_widget.test.cjs` pattern.

**Step 3: Run tests**

Run: `./tools/test-js-with-node web/tests/zform.test.cjs`
Expected: PASS

**Step 4: Commit**

```bash
git add web/tests/zform.test.cjs
git commit -m "zform: Add frontend tests for form widget.

Test form rendering, field collection, submission via callback,
inbound event handling, and null extra_data graceful degradation.

Fixes part of #6102."
```

---

### Task 9: Documentation update

**Files:**
- Modify: `docs/subsystems/widgets.md`

**Step 1: Read the existing widgets doc**

Run: Read `docs/subsystems/widgets.md` to understand the current structure.

**Step 2: Add form documentation**

Add a new section after the existing zform documentation section. The section should cover:

- The new `type: "form"` schema with a complete JSON example
- Supported field types table
- How form submission works (submessage flow)
- Bot-side code example for receiving submissions
- Graceful degradation notes

Follow the existing documentation style exactly — check the heading levels, code block style, etc.

**Step 3: Lint and commit**

```bash
git add docs/subsystems/widgets.md
git commit -m "docs: Document zform interactive forms.

Add documentation for the new 'form' type in the zform widget system,
including field types, submission flow, bot integration example, and
graceful degradation.

Fixes part of #6102."
```

---

### Task 10: Final verification

**Step 1: Run full backend test suite for widgets**

Run: `./tools/test-backend zerver.tests.test_widgets zerver.tests.test_submessage -v`
Expected: All PASS

**Step 2: Run full frontend test suite**

Run: `./tools/test-js-with-node`
Expected: All PASS

**Step 3: Run linter on all changed files**

Run:
```bash
./tools/lint \
    zerver/lib/validator.py \
    zerver/views/submessage.py \
    zerver/tests/test_widgets.py \
    web/src/zform.ts \
    web/src/zform_data.ts \
    web/src/generic_widget.ts \
    web/src/widget_schema.ts \
    web/styles/widgets.css \
    web/templates/widgets/zform_form.hbs \
    docs/subsystems/widgets.md
```
Expected: All PASS

**Step 4: Run mypy**

Run: `./tools/run-mypy`
Expected: No new errors

**Step 5: Review git log**

Run: `git log --oneline zform-interactive-forms`
Expected: Clean series of commits, each passing tests independently.
