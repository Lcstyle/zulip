"use strict";

const assert = require("node:assert/strict");

const {mock_esm, zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");
const blueslip = require("./lib/zblueslip.cjs");
const $ = require("./lib/zjquery.cjs");

let transmit_reply_message_args;
mock_esm("../src/transmit", {
    reply_message(message, content) {
        transmit_reply_message_args = {message, content};
    },
});

const zform = zrequire("zform");

function test(label, f) {
    run_test(label, (helpers) => {
        transmit_reply_message_args = undefined;
        f(helpers);
    });
}

test("activate choices type", () => {
    const $outer_elem = $.create("<zform choices>");

    const choices_data = {
        type: "choices",
        heading: "Pick a color",
        choices: [
            {type: "multiple_choice", short_name: "Red", long_name: "Red color", reply: "red"},
            {type: "multiple_choice", short_name: "Blue", long_name: "Blue color", reply: "blue"},
        ],
    };

    const message = {id: 100};

    const $buttons = $.create("<choice buttons>");
    $outer_elem.set_find_results("button", $buttons);

    const handle_events = zform.activate({
        $elem: $outer_elem,
        callback() {},
        any_data: {
            widget_type: "zform",
            extra_data: choices_data,
        },
        message,
    });

    assert.ok(handle_events);

    // Verify the outer element had HTML set (template was called).
    const html_content = $outer_elem.html();
    assert.notEqual(html_content, "never-been-set");

    // Simulate clicking the first choice button.
    const click_handler = $buttons.get_on_handler("click");
    assert.ok(click_handler);

    const $target = $.create("<choice button 0>");
    $target.attr("data-idx", "0");
    click_handler({
        stopPropagation() {},
        target: $target,
    });

    assert.deepEqual(transmit_reply_message_args, {
        message,
        content: "red",
    });
});

test("activate with null extra_data", () => {
    const $outer_elem = $.create("<zform null>");

    blueslip.expect("error", "invalid zform extra data");

    const handle_events = zform.activate({
        $elem: $outer_elem,
        callback() {},
        any_data: {
            widget_type: "zform",
            extra_data: null,
        },
        message: {id: 101},
    });

    assert.ok(handle_events);
    // Should be a noop handler.
    handle_events([]);
});

test("activate form type and submit", () => {
    const $outer_elem = $.create("<zform form>");

    const form_data = {
        type: "form",
        heading: "Create Card",
        fields: [
            {name: "title", type: "text", label: "Title"},
            {
                name: "category",
                type: "select",
                label: "Category",
                options: [
                    {label: "Bug", value: "bug"},
                    {label: "Feature", value: "feature"},
                ],
            },
        ],
        actions: [{name: "submit", label: "Submit"}],
    };

    // Mock the form field find results.
    const $action_buttons = $.create("<form action buttons>");
    $outer_elem.set_find_results("button.widget-form-action", $action_buttons);

    // Mock form field elements for collect_form_data.
    const $form_fields = $.create("<form fields>");
    $outer_elem.set_find_results(".widget-form-field", $form_fields);

    // Mock show_submitted_state selectors.
    const $inputs = $.create("<form inputs>");
    $outer_elem.set_find_results("input, textarea, select", $inputs);
    const $widget_form = $.create("<widget-form>");
    $outer_elem.set_find_results(".widget-form", $widget_form);

    let callback_data;
    const handle_events = zform.activate({
        $elem: $outer_elem,
        callback(data) {
            callback_data = data;
        },
        any_data: {
            widget_type: "zform",
            extra_data: form_data,
        },
        message: {id: 102},
    });

    assert.ok(handle_events);

    // Verify the outer element had HTML set.
    const html_content = $outer_elem.html();
    assert.notEqual(html_content, "never-been-set");

    // Simulate clicking a submit button.
    const click_handler = $action_buttons.get_on_handler("click");
    assert.ok(click_handler);

    const $submit_target = $.create("<submit button>");
    $submit_target.attr("data-action-name", "submit");

    // Override $form_fields to simulate .each() with no fields
    // (zjquery doesn't support .each() on set_find_results natively).
    // The form data will be empty, which is fine for testing the callback.
    $form_fields.each = function (fn) {
        // Simulate no fields to iterate over for simplicity.
    };

    click_handler({
        stopPropagation() {},
        target: $submit_target,
    });

    // Verify callback was called with FormSubmitData.
    assert.deepEqual(callback_data, {
        type: "form_submit",
        action: "submit",
        data: {},
    });

    // Verify submitted state was applied.
    assert.ok($inputs.prop("disabled"));
    assert.ok($action_buttons.prop("disabled"));
    assert.ok($widget_form.hasClass("widget-form-submitted"));

    // Clicking again should be a noop (form_submitted is true).
    callback_data = undefined;
    click_handler({
        stopPropagation() {},
        target: $submit_target,
    });
    assert.equal(callback_data, undefined);
});

test("handle_events with form_submit", () => {
    const $outer_elem = $.create("<zform events>");

    const form_data = {
        type: "form",
        heading: "Test Form",
        fields: [{name: "name", type: "text", label: "Name"}],
        actions: [{name: "ok", label: "OK"}],
    };

    const $action_buttons = $.create("<event action buttons>");
    $outer_elem.set_find_results("button.widget-form-action", $action_buttons);
    const $form_fields = $.create("<event form fields>");
    $outer_elem.set_find_results(".widget-form-field", $form_fields);
    const $inputs = $.create("<event inputs>");
    $outer_elem.set_find_results("input, textarea, select", $inputs);
    const $widget_form = $.create("<event widget-form>");
    $outer_elem.set_find_results(".widget-form", $widget_form);

    const handle_events = zform.activate({
        $elem: $outer_elem,
        callback() {},
        any_data: {
            widget_type: "zform",
            extra_data: form_data,
        },
        message: {id: 103},
    });

    // Send a form_submit event from another user.
    handle_events([
        {
            sender_id: 200,
            data: {
                type: "form_submit",
                action: "ok",
                data: {name: "Alice"},
            },
        },
    ]);

    // Verify submitted state was shown.
    assert.ok($inputs.prop("disabled"));
    assert.ok($action_buttons.prop("disabled"));
    assert.ok($widget_form.hasClass("widget-form-submitted"));
});

test("handle_events ignores non-form_submit events", () => {
    const $outer_elem = $.create("<zform ignore events>");

    const form_data = {
        type: "form",
        heading: "Test",
        fields: [{name: "x", type: "text", label: "X"}],
        actions: [{name: "go", label: "Go"}],
    };

    const $action_buttons = $.create("<ignore action buttons>");
    $outer_elem.set_find_results("button.widget-form-action", $action_buttons);
    const $form_fields = $.create("<ignore form fields>");
    $outer_elem.set_find_results(".widget-form-field", $form_fields);
    const $inputs = $.create("<ignore inputs>");
    $outer_elem.set_find_results("input, textarea, select", $inputs);
    const $widget_form = $.create("<ignore widget-form>");
    $outer_elem.set_find_results(".widget-form", $widget_form);

    const handle_events = zform.activate({
        $elem: $outer_elem,
        callback() {},
        any_data: {
            widget_type: "zform",
            extra_data: form_data,
        },
        message: {id: 104},
    });

    // Send unrelated events.
    handle_events([
        {sender_id: 200, data: null},
        {sender_id: 200, data: "not an object"},
        {sender_id: 200, data: {type: "something_else"}},
    ]);

    // Form should NOT be in submitted state.
    assert.equal($inputs.prop("disabled"), undefined);
});
