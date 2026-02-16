import assert from "minimalistic-assert";

import render_widgets_rich_embed from "../templates/widgets/rich_embed.hbs";

import * as blueslip from "./blueslip.ts";
import type {Message} from "./message_store.ts";
import type {Event} from "./widget_data.ts";
import type {AnyWidgetData} from "./widget_schema.ts";

export const widget_type = "rich_embed";

export function activate({
    $elem: $outer_elem,
    any_data,
}: {
    $elem: JQuery;
    callback: (data: never) => void;
    any_data: AnyWidgetData;
    message: Message;
}): (events: Event[]) => void {
    assert(any_data.widget_type === "rich_embed");
    if (any_data.extra_data === null) {
        blueslip.error("invalid rich_embed extra data");
        return (_events: Event[]): void => {
            /* noop */
        };
    }
    const data = any_data.extra_data;

    const html = render_widgets_rich_embed(data);
    $outer_elem.html(html);

    // Rich embeds are read-only; no inbound events to handle.
    return (_events: Event[]): void => {
        /* noop */
    };
}
