# @creatomate/n8n-nodes-creatomate

This is the official n8n community node for [Creatomate](https://creatomate.com). It lets you generate
videos and images from your Creatomate templates in your n8n workflows.

Creatomate is a media automation platform: you design a template once in the visual editor, mark the
parts that should change as dynamic, and render as many variations as you need through the API.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow
automation platform.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n
community nodes documentation, and use `@creatomate/n8n-nodes-creatomate` as the package name.

## Operations

- **Render**
  - **Create**: render a video or image from one of your templates, or from RenderScript (JSON). The node
    can wait for the render to finish and return the file URL.
  - **Get**: look up the status and result of a render by ID.
- **Template**
  - **Create**: add a new template to your project from RenderScript (JSON).
  - **Get**: fetch a template, including its source.
  - **Get Many**: list the templates in your project, optionally filtered by tags and capped with a
    limit.
  - **Update**: change a template's name, tags, or source.
  - **Delete**: remove a template from your project.

## Credentials

You need a Creatomate account and a project API key.

1. Sign in at [creatomate.com](https://creatomate.com).
2. Open **Project Settings > API Key** and copy the key of the project you want to use.
3. In n8n, create a new **Creatomate API** credential and paste the key.

A key belongs to a single project, so add one credential per Creatomate project.

## Compatibility

Built and tested against n8n 2.x. Current n8n 2.x releases require Node.js 24 or later.

## Usage

### Rendering a template

Choose **Render > Create**, pick a template from the list, and the node loads that template's **dynamic
elements** as modification fields. Every element you marked as *Dynamic* in the Creatomate editor shows up
here, so you can fill it with data from earlier steps in your workflow.

If a template has no fields to fill, open it in the editor, select an element, and enable **Dynamic** in the
right-side property panel.

Use **Map Automatically** when the incoming item already has keys matching the field names, so a
spreadsheet row or a database record maps straight onto the template.

### Waiting for the render

**Wait for Completion** is on by default: the node polls the render and returns once the file is ready, so
the next node can use `url` directly. Renders take anywhere from a few seconds to several minutes depending
on the length and complexity of the video.

Turn it off for fire-and-forget workflows. The node then returns immediately with a `planned` render, and
you can fetch the result later with the **Get** operation, or set a **Webhook URL** so Creatomate calls you
back when the render is done.

While waiting, a rate limit or a hiccup on the connection does not fail the node: the render is already
running, so the node keeps polling until it settles or **Max Wait Time** runs out.

### Changing anything else

**Additional Modifications** in the options takes selector/value pairs, which reach any property of any
element, including elements that are not marked as dynamic. For example, the selector `Text-1.fill_color`
with value `#ff0000` renders that text in red.

A selector that matches no element does not fail the render, since the rest of it is still valid. Instead
the node's output carries a `warnings` entry naming the selector, usually with a suggested correction. That
is the quickest way to catch a typo in a workflow that renders the wrong thing.

### Managing templates

The **Template** operations cover the full lifecycle: create templates from RenderScript, list or fetch
them, update a name, tags, or source, and delete them. Creatomate validates the source whenever a template
is saved: an invalid source is rejected with a clear error, and parts the renderer would silently ignore
come back as `warnings` on the response.

## Resources

- [Creatomate API documentation](https://creatomate.com/docs/api/quick-start/introduction)
- [RenderScript reference](https://creatomate.com/docs/api/render-script/introduction)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE.md)
