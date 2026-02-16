import $ from "jquery";
import assert from "minimalistic-assert";

import render_widgets_zform_choices from "../templates/widgets/zform_choices.hbs";
import render_widgets_zform_form from "../templates/widgets/zform_form.hbs";

import * as blueslip from "./blueslip.ts";
import type {Message} from "./message_store.ts";
import * as transmit from "./transmit.ts";
import type {Event} from "./widget_data.ts";
import type {AnyWidgetData} from "./widget_schema.ts";
import type {FormResultData, FormSubmitData, ZFormChoicesExtraData, ZFormFormExtraData} from "./zform_data.ts";
import {form_result_schema, form_submit_schema} from "./zform_data.ts";

export const widget_type = "zform";

export function activate({
    $elem: $outer_elem,
    callback,
    any_data,
    message,
}: {
    $elem: JQuery;
    callback: (data: FormSubmitData) => void;
    any_data: AnyWidgetData;
    message: Message;
}): (events: Event[]) => void {
    assert(any_data.widget_type === "zform");
    if (any_data.extra_data === null) {
        blueslip.error("invalid zform extra data");
        return (_events: Event[]): void => {
            /* noop */
        };
    }
    const data = any_data.extra_data;
    let form_submitted = false;

    function render_choices(data: ZFormChoicesExtraData): void {
        // Assign idx values to each of our choices so that
        // our template can create data-idx values for our
        // JS code to use later.
        const data_with_choices_with_idx = {
            ...data,
            choices: data.choices.map((choice, idx) => ({...choice, idx})),
        };

        const html = render_widgets_zform_choices(data_with_choices_with_idx);
        $outer_elem.html(html);

        $outer_elem.find("button").on("click", (e) => {
            e.stopPropagation();

            // Grab our index from the markup.
            const idx = Number.parseInt($(e.target).attr("data-idx")!, 10);

            // Use the index from the markup to dereference our
            // data structure.
            const reply_content = data.choices[idx]!.reply;

            transmit.reply_message(message, reply_content);
        });
    }

    function collect_form_data(): Record<string, unknown> {
        const form_data: Record<string, unknown> = {};

        $outer_elem.find(".widget-form-field").each(function () {
            const $field = $(this);
            const field_name = $field.attr("data-field-name")!;

            const $input = $field.find("input.widget-form-input");
            if ($input.length > 0) {
                form_data[field_name] = $input.val();
                return;
            }

            const $textarea = $field.find("textarea.widget-form-textarea");
            if ($textarea.length > 0) {
                form_data[field_name] = $textarea.val();
                return;
            }

            const $select = $field.find("select.widget-form-select");
            if ($select.length > 0) {
                form_data[field_name] = $select.val();
                return;
            }

            const $checkboxes = $field.find(
                ".widget-form-checkbox-group input[type=checkbox]:checked",
            );
            if ($checkboxes.length > 0) {
                const values: string[] = [];
                $checkboxes.each(function () {
                    values.push($(this).val() as string);
                });
                form_data[field_name] = values;
                return;
            }

            // checkbox_group with nothing checked
            if ($field.find(".widget-form-checkbox-group").length > 0) {
                form_data[field_name] = [];
            }
        });

        return form_data;
    }

    function show_submitted_state(): void {
        form_submitted = true;
        $outer_elem.find("input, textarea, select").prop("disabled", true);
        $outer_elem.find("button.widget-form-action").prop("disabled", true);
        $outer_elem.find(".widget-form").addClass("widget-form-submitted");
    }

    function render_form(data: ZFormFormExtraData): void {
        // Precompute boolean flags for each field type since
        // Handlebars does not have an equality helper.
        const fields_with_flags = data.fields.map((field) => ({
            ...field,
            is_text: field.type === "text",
            is_textarea: field.type === "textarea",
            is_select: field.type === "select",
            is_checkbox_group: field.type === "checkbox_group",
            is_date: field.type === "date",
        }));

        const template_data = {
            heading: data.heading,
            fields: fields_with_flags,
            actions: data.actions,
        };

        const html = render_widgets_zform_form(template_data);
        $outer_elem.html(html);

        // Bind submit handlers after the HTML is in the DOM.
        $outer_elem.find("button.widget-form-action").on("click", (e) => {
            e.stopPropagation();

            if (form_submitted) {
                return;
            }

            const action_name = $(e.target).attr("data-action-name")!;
            const collected_data = collect_form_data();

            const submit_data: FormSubmitData = {
                type: "form_submit",
                action: action_name,
                data: collected_data,
            };

            callback(submit_data);
            show_submitted_state();
        });
    }

    function render(): void {
        if (data.type === "choices") {
            render_choices(data);
        } else if (data.type === "form") {
            render_form(data);
        }
    }

    function show_result(result: FormResultData): void {
        const is_success = result.status === "success";
        const css_class = is_success ? "widget-form-result-success" : "widget-form-result-error";
        const $result = $("<div>").addClass("widget-form-result").addClass(css_class);

        if (result.title && result.url) {
            $result.append(
                $("<a>")
                    .attr("href", result.url)
                    .attr("target", "_blank")
                    .attr("rel", "noopener noreferrer")
                    .text(result.title),
            );
        }

        if (result.message) {
            $result.append($("<div>").addClass("widget-form-result-message").text(result.message));
        }

        $outer_elem.empty().append($result);
    }

    function handle_events(events: Event[]): void {
        for (const event of events) {
            if (typeof event.data !== "object" || event.data === null) {
                continue;
            }

            const result_parsed = form_result_schema.safeParse(event.data);
            if (result_parsed.success) {
                show_result(result_parsed.data);
                continue;
            }

            const parsed = form_submit_schema.safeParse(event.data);
            if (parsed.success) {
                if (!form_submitted) {
                    show_submitted_state();
                }
            }
        }
    }

    render();

    return handle_events;
}
