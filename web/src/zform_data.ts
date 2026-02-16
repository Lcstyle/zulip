import * as z from "zod/mini";

/*
    The zform widget supports two types:

    1. "choices" — presents the user with a list of choices and buttons.
       The prime example is the trivia bot. When the user clicks a
       choice, a reply is sent as a regular message.

    2. "form" — presents the user with a form containing input fields
       (text, textarea, select, checkbox_group, date) and action
       buttons. When the user submits, data is sent as a submessage
       back to the bot (message sender).

    See docs/subsystems/widgets.md for more details.
*/

// --- Choices type (existing) ---

export const zform_choices_extra_data_schema = z.object({
    choices: z.array(
        z.object({
            type: z.string(),
            long_name: z.string(),
            reply: z.string(),
            short_name: z.string(),
        }),
    ),
    heading: z.string(),
    type: z.literal("choices"),
});

export type ZFormChoicesExtraData = z.infer<typeof zform_choices_extra_data_schema>;

// --- Form type (new) ---

const form_option_schema = z.object({
    label: z.string(),
    value: z.string(),
});

const form_text_field_schema = z.object({
    name: z.string(),
    type: z.literal("text"),
    label: z.string(),
    required: z.optional(z.boolean()),
    placeholder: z.optional(z.string()),
    default: z.optional(z.string()),
});

const form_textarea_field_schema = z.object({
    name: z.string(),
    type: z.literal("textarea"),
    label: z.string(),
    required: z.optional(z.boolean()),
    placeholder: z.optional(z.string()),
    default: z.optional(z.string()),
});

const form_select_field_schema = z.object({
    name: z.string(),
    type: z.literal("select"),
    label: z.string(),
    required: z.optional(z.boolean()),
    options: z.array(form_option_schema),
    default: z.optional(z.string()),
});

const form_checkbox_group_field_schema = z.object({
    name: z.string(),
    type: z.literal("checkbox_group"),
    label: z.string(),
    required: z.optional(z.boolean()),
    options: z.array(form_option_schema),
    default: z.optional(z.array(z.string())),
});

const form_date_field_schema = z.object({
    name: z.string(),
    type: z.literal("date"),
    label: z.string(),
    required: z.optional(z.boolean()),
    default: z.optional(z.string()),
});

export const form_field_schema = z.discriminatedUnion("type", [
    form_text_field_schema,
    form_textarea_field_schema,
    form_select_field_schema,
    form_checkbox_group_field_schema,
    form_date_field_schema,
]);

export type FormField = z.infer<typeof form_field_schema>;

export const form_action_schema = z.object({
    name: z.string(),
    label: z.string(),
    style: z.optional(z.string()),
});

export type FormAction = z.infer<typeof form_action_schema>;

export const zform_form_extra_data_schema = z.object({
    type: z.literal("form"),
    heading: z.string(),
    fields: z.array(form_field_schema),
    actions: z.array(form_action_schema),
});

export type ZFormFormExtraData = z.infer<typeof zform_form_extra_data_schema>;

// --- Discriminated union of all zform types ---

export const zform_widget_extra_data_schema = z.discriminatedUnion("type", [
    zform_choices_extra_data_schema,
    zform_form_extra_data_schema,
]);

export type ZFormExtraData = z.infer<typeof zform_widget_extra_data_schema>;

// --- Rich embed type ---

const rich_embed_field_schema = z.object({
    name: z.string(),
    value: z.string(),
    inline: z.optional(z.boolean()),
});

export const rich_embed_extra_data_schema = z.object({
    type: z.literal("rich_embed"),
    title: z.optional(z.string()),
    description: z.optional(z.string()),
    url: z.optional(z.string()),
    color: z.optional(z.string()),
    fields: z.optional(z.array(rich_embed_field_schema)),
    footer: z.optional(z.string()),
});

export type RichEmbedExtraData = z.infer<typeof rich_embed_extra_data_schema>;

// --- Form submission outbound data ---

export const form_submit_schema = z.object({
    type: z.literal("form_submit"),
    action: z.string(),
    data: z.record(z.string(), z.unknown()),
});

export type FormSubmitData = z.infer<typeof form_submit_schema>;

// --- Form result inbound data (sent by bot after processing) ---

export const form_result_schema = z.object({
    type: z.literal("form_result"),
    status: z.string(),
    title: z.optional(z.string()),
    url: z.optional(z.string()),
    message: z.optional(z.string()),
});

export type FormResultData = z.infer<typeof form_result_schema>;
