import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { TriggerStudio } from "./studio.js";

async function request(path, body) {
    const response = await api.fetchApi(`/lora-trigger-studio${path}`, body === undefined ? {} : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("The node API is unavailable. Restart ComfyUI after installing it.");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
    return data;
}

const style = document.createElement("link");
style.rel = "stylesheet";
style.href = new URL("./studio.css", import.meta.url).href;
document.head.append(style);

app.registerExtension({
    name: "ComfyUI.Kirei.LoRATriggerStudio",
    nodeCreated(node) {
        if (node.comfyClass !== "LoRATriggerStudio") return;
        const config = node.widgets.find(w => w.name === "config");
        config.type = "converted-widget";
        config.hidden = true;
        config.computeSize = () => [0, -4];
        config.draw = () => {};
        const root = document.createElement("div");
        let preferredHeight = 440;
        let configuring = false;
        const studio = new TriggerStudio(root, {
            raw: config.value,
            write: value => { config.value = value; app.graph?.change(); node.setDirtyCanvas(true, true); },
            hasClip: () => node.inputs?.some(i => i.name === "clip" && i.link != null),
            layout: height => {
                if (height === preferredHeight) return;
                preferredHeight = height;
                if (!configuring) node.setSize([Math.max(420, node.size[0]), height + 80]);
            },
            apiURL: path => api.apiURL(`/lora-trigger-studio${path}`),
            request,
        });
        node.addDOMWidget("trigger_studio", "LoRATriggerStudio", root, {
            serialize: false, hideOnZoom: false, getMinHeight: () => 260,
            getHeight: () => Math.max(260, node.size[1] - 80),
        });
        const configure = node.onConfigure;
        node.onConfigure = function (...args) {
            const result = configure?.apply(this, args);
            configuring = true;
            try { studio.load(config.value); } finally { configuring = false; }
            void studio.checkFiles();
            return result;
        };
        const connections = node.onConnectionsChange;
        node.onConnectionsChange = function (...args) { const result = connections?.apply(this, args); studio.updatePreview(); return result; };
        const removed = node.onRemoved;
        node.onRemoved = function (...args) { studio.destroy(); return removed?.apply(this, args); };
        node.setSize([440, preferredHeight + 80]);
        void studio.checkFiles();
    },
});
