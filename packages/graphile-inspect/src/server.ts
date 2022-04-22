import { readFileSync } from "fs";
import { GraphiQLProps } from "graphiql";
import * as path from "path";

function escapeHTMLEntities(str: string): string {
  return str.replace(
    /[&"<>]/g,
    (l) =>
      ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" }[l as any]),
  );
}

// TODO: make this 'readFileSync' call webpackable
const graphiQLContent = readFileSync(
  path.resolve(__dirname, "../bundle/graphile-inspect.min.js"),
  "utf8",
);

// Ref: https://v8.dev/features/subsume-json
const escapeJS = (str: string) => {
  return str
    .replaceAll("<!--", "<\\!--")
    .replaceAll("</script", "<\\/script")
    .replaceAll("<script", "<\\script");
};

const graphiQLHeader = `\
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Graphile Inspect</title>
<script src="https://unpkg.com/prettier@1.13.0/standalone.js"></script>
<script src="https://unpkg.com/prettier@1.13.0/parser-graphql.js"></script>
</head>
<body style="margin: 0;">
<div style="height: 100vh;" id="graphile-inspect-root"></div>
<link href="https://unpkg.com/graphiql/graphiql.min.css" rel="stylesheet" />
<script>${escapeJS(graphiQLContent)}</script>
<script>
  const { React, ReactDOM, GraphileInspect } = GraphileInspectBundle;
  const tree = React.createElement(GraphileInspect, `;

const graphiQLFooter = `\
);
  const root = document.getElementById("graphile-inspect-root");
  ReactDOM.render(tree, root);
</script>
</body>
</html>
`;

export interface GraphileInspectServerConfig {
  /**
   * The URL to the GraphQL endpoint.
   */
  url?: string;
  editorTheme?: GraphiQLProps["editorTheme"];
}

export function graphileInspectHTML(config: GraphileInspectServerConfig) {
  return `${graphiQLHeader}${escapeJS(
    JSON.stringify(config),
  )}${graphiQLFooter}`;
}
