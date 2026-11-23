import { GalleryExample as Example } from './GalleryExample';
import { ReadingLayout } from './ReadingLayout';
import { TopBar } from './TopBar';
import type { TopBarProps } from './TopBar';
import { WorkNav } from './WorkNav';
import type { WorkNavActive, WorkNavProps } from './WorkNav';
import { WorkspaceLayout } from './WorkspaceLayout';

const topBar = {
  workspaceCount: 4,
  notificationCount: 2,
  searchShortcut: false,
} satisfies TopBarProps;
const workNav = {
  scope: 'For page authors and reviewers of bioimaging/',
  counts: { inbox: 4, proposals: 6, discussions: 3, recheck: 2, ops: 1 },
  footer: {
    reviewerStatus: 'reviewer-agent is on · 14 published today',
    autoPublishStatus: 'AUTO_PUBLISH on',
  },
} satisfies WorkNavProps;

export function NavigationExamples() {
  return (
    <>
      <section
        aria-labelledby="gallery-topbars"
        className="relative left-1/2 flex w-screen -translate-x-1/2 flex-col gap-12px"
      >
        <h2 id="gallery-topbars" className="px-24px text-20 font-semibold">
          Top bar
        </h2>
        {(
          ['home', 'browse', 'recent', 'search', 'you', 'workspace', 'none', 'reader'] as const
        ).map((variant) => (
          <Example key={variant} id={`TopBar/${variant}`}>
            <TopBar
              {...topBar}
              landmarkContext={`Top bar ${variant}`}
              active={variant === 'reader' ? 'home' : variant}
              role={variant === 'reader' ? 'reader' : 'page author'}
              query={variant === 'search' ? 'pinhole size' : ''}
            />
          </Example>
        ))}
      </section>
      <section
        aria-labelledby="gallery-worknavs"
        className="relative left-1/2 flex w-screen -translate-x-1/2 flex-col gap-12px"
      >
        <h2 id="gallery-worknavs" className="px-24px text-20 font-semibold">
          Workspace menu
        </h2>
        <div className="flex flex-col gap-12px">
          {(
            [
              'inbox',
              'proposals',
              'discussions',
              'recheck',
              'mine',
              'ops',
              'settings',
            ] satisfies WorkNavActive[]
          ).map((variant) => (
            <Example key={variant} id={`WorkNav/${variant}`}>
              <WorkNav {...workNav} active={variant} landmarkContext={`Menu ${variant}`} />
            </Example>
          ))}
        </div>
      </section>
      <section
        aria-labelledby="gallery-layouts"
        className="relative left-1/2 flex w-screen -translate-x-1/2 flex-col gap-12px"
      >
        <h2 id="gallery-layouts" className="px-24px text-20 font-semibold">
          Layouts
        </h2>
        <Example id="ReadingLayout/home">
          <ReadingLayout
            as="div"
            topBar={{ ...topBar, landmarkContext: 'Reading layout' }}
            aside={
              <div className="rounded-12 border border-edge bg-surface p-16px">Reading aside</div>
            }
          >
            <div className="rounded-12 border border-edge bg-surface p-16px">Reading content</div>
          </ReadingLayout>
        </Example>
        <Example id="WorkspaceLayout/inbox">
          <WorkspaceLayout
            as="div"
            topBar={{ ...topBar, landmarkContext: 'Workspace layout' }}
            workNav={{ ...workNav, landmarkContext: 'Workspace layout' }}
          >
            <div className="rounded-10 border border-edge bg-surface p-16px">Workspace content</div>
          </WorkspaceLayout>
        </Example>
      </section>
    </>
  );
}

export function UndrawnNavigationExamples() {
  return (
    <>
      <Example id="TopBar/hover-pressed">
        <TopBar {...topBar} active="none" landmarkContext="Hover and pressed example" />
      </Example>
      <Example id="WorkNav/hover-pressed">
        <div className="w-workspace-nav">
          <WorkNav {...workNav} landmarkContext="Hover and pressed example" />
        </div>
      </Example>
    </>
  );
}
