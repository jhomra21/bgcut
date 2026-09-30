export const ContentBreadcrumb = (props: {
  readonly parentHref: string;
  readonly parentLabel: string;
  readonly currentLabel: string;
}) => (
  <nav class="content-breadcrumb" aria-label="Breadcrumb">
    <ol>
      <li><a href={props.parentHref}>{props.parentLabel}</a></li>
      <li class="content-breadcrumb-separator" aria-hidden="true">/</li>
      <li aria-current="page">{props.currentLabel}</li>
    </ol>
  </nav>
);
