Feature: Newspaper layout scenarios
  Layout scenarios are durable examples of newspaper behavior.
  They verify both the solver's decisions and the rendered page geometry.

  Scenario: Current edition renders from the composable layout engine
    Given I open the "current-edition" layout scenario at 1280 by 900
    Then the active content scenario should be "current-edition"
    And the active content source should be "scenario"
    And the active edition should expose a composable layout plan
    And the solved layout should use 6 columns
    And the front page should label article "agent-procedure-patterns" as continued on page 2
    And the front page should label article "schools-reading-lab" as continued on page 3
    And the front page should label article "market-hall" as continued on page 3
    When I scroll to page 3
    Then the active page should be a "regionStack" page
    And no measured line should be cropped
    And no solved furniture should overlap within a section
    And no measured line should overlap solved furniture
    And no continuation column should be dead
    And the "schools-reading-lab" section should show a responsive image inset
    And the "schools-reading-lab" section image should span 2 columns
    And the "schools-reading-lab" section image should be right aligned at the top
    And the "schools-reading-lab" section image should leave one rhythm row before copy
    And the "schools-reading-lab" section adjacent copy should flow beside the image
    And no browser console errors should occur

  Scenario Outline: Responsive pages preserve a shared vertical rhythm
    Given I open the "current-edition" layout scenario at <width> by <height>
    Then the active page should follow the vertical rhythm
    When I scroll to page 3
    Then the active page should follow the vertical rhythm
    And no measured line should be cropped
    And no browser console errors should occur

    Examples:
      | width | height |
      | 1280  | 900    |
      | 1280  | 1600   |
      | 640   | 1200   |
      | 390   | 900    |

  Scenario Outline: Shared continuations repair blank-column pressure
    Given I open the "shared-blank-column-pressure" layout scenario at <width> by <height>
    Then the solved layout should use <columns> columns
    When I scroll to page 3
    Then the active page should be a "regionStack" page
    And no measured line should be cropped
    And no solved furniture should overlap within a section
    And no measured line should overlap solved furniture
    And no continuation column should be dead
    And no browser console errors should occur

    Examples:
      | width | height | columns |
      | 1280  | 900    | 6       |
      | 640   | 1200   | 3       |
      | 390   | 900    | 1       |

  Scenario: Front page uses GraphQL content by default
    Given I open the front page at 1280 by 900
    Then the active content source should be "graphql"
    And the active edition should expose a composable layout plan
    And the solved layout should use 6 columns
    And the active edition should include article "schools-reading-lab"
    And edition pages should sit on a neutral gray substrate with one rhythm row between pages
    When I scroll to page 2
    Then the active page should be a "articlePage" page
    And the inside page header should center labels on the rhythm row
    And the "agent-procedure-patterns" continuation should not repeat front-page images
    And continuation title chrome should be compact
    And the active page should follow the vertical rhythm
    And no measured line should be cropped
    And no browser console errors should occur

  Scenario: Front feature slots control headline, copy, and right-side image
    Given I open the "current-edition" layout scenario at 1280 by 900
    Then the front article "agent-procedure-patterns" should use the requested slot composition
    And the first three front stories should not reserve top rules
    And front jump labels should use upper-row rhythm without h-rules
    And the front article "agent-procedure-patterns" should share one copy band below lead furniture
    And the front page should resolve editorial priority "primary" for article "agent-procedure-patterns"
    And the front page should resolve headline scale "rail" for article "schools-reading-lab"
    And the front page should resolve headline scale "feature" for article "agent-procedure-patterns"
    And the front page should resolve headline scale "rail" for article "market-hall"
    And the front headline for article "agent-procedure-patterns" should be larger than articles "schools-reading-lab" and "market-hall"
    And no article chrome should overlap
    And no measured line should be cropped
    And no measured line should overlap solved furniture
    And no browser console errors should occur

  Scenario: Primary front story leads the mobile sequence
    Given I open the "current-edition" layout scenario at 390 by 900
    Then the solved layout should use 1 columns
    And the first front story should be article "agent-procedure-patterns"
    And the front page should resolve editorial priority "primary" for article "agent-procedure-patterns"
    And the front article "agent-procedure-patterns" should stack its image below title chrome
    And no article chrome should overlap
    And no measured line should overlap solved furniture
    And no measured line should be cropped
    And no browser console errors should occur

  Scenario: Four-column front page uses a responsive feature-top recipe
    Given I open the "current-edition" layout scenario at 900 by 1200
    Then the solved layout should use 4 columns
    And the first front story should be article "agent-procedure-patterns"
    And front article "agent-procedure-patterns" should occupy row 1 columns 1 through 4
    And front article "schools-reading-lab" should occupy row 2 columns 1 through 2
    And front article "market-hall" should occupy row 2 columns 3 through 4
    And the front article "agent-procedure-patterns" should inset its image in the top right half
    And the front article "agent-procedure-patterns" should flow copy around the inset image
    And the front page should render article "market-hall"
    And no measured line should be cropped
    And no browser console errors should occur

  Scenario: Three-column front feature keeps media inset out of article chrome
    Given I open the "current-edition" layout scenario at 780 by 1200
    Then the solved layout should use 3 columns
    And the first front story should be article "agent-procedure-patterns"
    And front article "agent-procedure-patterns" should occupy row 1 columns 1 through 3
    And the front article "agent-procedure-patterns" should stack its headline above the three-column media inset
    And the front article "agent-procedure-patterns" should flow copy around the inset image
    And no article chrome should overlap
    And no measured line should be cropped
    And no browser console errors should occur

  Scenario: Front page renders a newspaper footer
    Given I open the "current-edition" layout scenario at 1280 by 900
    Then the front page should render a newspaper footer
    And the front page footer should list edition sections
    And the front page solved height should include footer rhythm space
    And the front page footer should stack utility links in the right column
    When I scroll to page 2
    Then the active page should not render a front page footer
    And no browser console errors should occur

  Scenario Outline: Front page footer remains visible at responsive widths
    Given I open the front page at <width> by <height>
    Then the front page should render a newspaper footer
    And the front page footer should fit within the solved page
    And no browser console errors should occur

    Examples:
      | width | height |
      | 1280  | 900    |
      | 900   | 1200   |
      | 780   | 1200   |
      | 390   | 900    |

  Scenario: News desk renders topic steering proposals and topic edits
    Given I open the news desk at 1280 by 900
    Then the news desk should render
    And the news desk should show topic and graph proposal rows
    And the news desk should show accepted subtopics under canonical topics
    And the news desk should show proposed subtopics under canonical topics
    And the news desk should offer accept and reject actions without defer
    When I update the first news desk topic name to "Foundation Model Scaling Updated"
    Then the first news desk topic name should be "Foundation Model Scaling Updated"
    And no browser console errors should occur

  Scenario: News desk manually culls assignment candidates
    Given I open the assignments news desk at 1280 by 900
    Then the assignments desk should render
    When I cull assignment "assignment-demo-agent-lab" with reason "Too thin"
    Then assignment "assignment-demo-agent-lab" should be culled
    When I restore assignment "assignment-demo-agent-lab"
    Then assignment "assignment-demo-agent-lab" should be active
    And no browser console errors should occur

  Scenario: Production news desk requires editor access
    Given I open the edition path "/news-desk" at 1280 by 900
    Then the news desk should show an editor access gate
    And no browser console errors should occur

  Scenario: Unauthenticated readers do not see News Desk appendix pages
    Given I open the "current-edition" layout scenario at 1280 by 900
    Then edition page count should not include appended News Desk pages
    And the front page footer should not link to the news desk
    And no News Desk appendix pages should render
    And no browser console errors should occur

  Scenario: Editor readers see News Desk appendix pages after the edition
    Given I am a test editor reader
    And I open the "current-edition" layout scenario at 1280 by 900
    Then edition page count should include appended News Desk pages
    When I scroll to the canonical topic register
    Then the final edition pages should include the canonical topic register
    And the appendix page should use newspaper page styling
    When I scroll to the appendix page for root topic "Foundation Model Scaling"
    Then the root topic appendix page should show subtopic "Agent Memory"
    And no browser console errors should occur

  Scenario: News Desk appendix pages fit on mobile
    Given I am a test editor reader
    And I open the "current-edition" layout scenario at 390 by 900
    When I scroll to the canonical topic register
    Then the News Desk appendix should not overflow horizontally
    And no browser console errors should occur

  Scenario: Archive renders an infinite front page grid
    Given I open the archive page at 1280 by 900
    Then the archive masthead should say "ARCHIVE"
    And the archive masthead should use the normal newspaper nameplate height
    And the archive header should describe previous editions
    And the archive page should expose the shared rhythm overlay
    And the archive layout should follow the archive rhythm
    And the archive should render front page preview cards
    And archive preview cards should be compact on the rhythm
    And archive preview cards should link to canonical edition routes
    And archive previews should include masthead, front grid, and footer
    And the archive should use a paper header over a neutral gray grid substrate
    And the archive API should cap requested batches at 12
    And the archive sentinel should load another batch when more editions exist
    And no browser console errors should occur

  Scenario: Archive uses a two-column phone grid
    Given I open the archive page at 390 by 900
    Then the archive should render front page preview cards
    And the archive should render a two-column front page grid
    And no browser console errors should occur

  Scenario: Scroll edition materializes visible pages and keeps placeholders
    Given I open the front page at 1280 by 900
    Then page 1 should be materialized
    And page 2 should be materialized
    And page 3 should be a page placeholder
    And no flipbook UI classes should be rendered
    When I scroll to page 3
    Then page 3 should be materialized
    And the active visible page should be 3
    And no browser console errors should occur

  Scenario: Continuation jump uses GSAP ScrollTo jump
    Given I open the front page at 1280 by 900
    When I follow the continuation jump for article "schools-reading-lab"
    Then the active visible page should be 3
    And the browser path should be "/2026/may/13/page/3"
    And page 3 should be materialized
    And no browser console errors should occur

  Scenario: Date page routes replace page hash state
    Given I open the edition path "/2026/may/13/page/2" at 1280 by 900
    Then the active visible page should be 2
    And the browser path should be "/2026/may/13/page/2"
    When I scroll to page 3
    Then the active visible page should be 3
    And the browser path should be "/2026/may/13/page/3"
    And no browser console errors should occur

  Scenario: Date-scoped article routes and edition anchors resolve
    Given I open the edition path "/2026/may/13/agent-procedure-patterns" at 1280 by 900
    Then the article page should show headline "The Next Agent Breakthrough Is a Checklist"
    And the article back link should target "/2026/may/13#agent-procedure-patterns"
    Given I open the edition path "/2026/may/13#agent-procedure-patterns" at 1280 by 900
    Then the browser hash should be "#agent-procedure-patterns"
    And article "agent-procedure-patterns" should have exactly one edition anchor
    And no browser console errors should occur

  Scenario: Layout validation accepts only canonical headline scales
    Then layout plan validation should accept headline scale "feature"
    And layout plan validation should reject headline scale "poster"
    And layout plan validation should accept editorial priority "primary"
    And layout plan validation should reject editorial priority "urgent"

  Scenario: Scroll edition reaches pages one at a time
    Given I open the "current-edition" layout scenario at 1280 by 900
    When I scroll to page 2
    Then the active page should be a "articlePage" page
    When I scroll to page 3
    Then the active page should be a "regionStack" page
    When I scroll to page 2
    Then the active page should be a "articlePage" page
    And no browser console errors should occur

  Scenario: Shared continuation uses pull quotes when they improve the fit
    Given I open the "current-edition" layout scenario at 1280 by 900
    When I scroll to page 3
    Then the "schools-reading-lab" section should show a responsive pull quote
    And the "market-hall" section should show a responsive pull quote
    And responsive pull quotes should have no background
    And responsive pull quotes should fit their quote text without excess rows
    And responsive pull quotes should leave one rhythm row before copy
    And no solved furniture should overlap within a section
    And no measured line should overlap solved furniture
    And no browser console errors should occur

  Scenario: Single-story continuation can shrink to solved content
    Given I open the "current-edition" layout scenario at 1280 by 900
    When I scroll to page 2
    Then the "agent-procedure-patterns" section should exhaust the remaining article text
    And the active continuation region should shrink to its solved blocks
    And the active page should follow the vertical rhythm
    And no browser console errors should occur

  Scenario: Stacked continuation regions fill by default
    Given I open the "height-policy-fill-default" layout scenario at 1280 by 900
    When I scroll to page 2
    Then the active continuation region should preserve allocated fill height
    And the active page should follow the vertical rhythm
    And no browser console errors should occur

  Scenario: Article frames honor default row targets
    Given I open the "height-policy-default-rows" layout scenario at 1280 by 900
    When I scroll to page 2
    Then the "agent-procedure-patterns" section should hold exactly 64 default rows
    And the active continuation region should shrink to its solved blocks
    And the active page should follow the vertical rhythm
    And no browser console errors should occur

  Scenario: Article frames can grow beyond default row targets
    Given I open the "height-policy-default-rows-grow" layout scenario at 1280 by 900
    When I scroll to page 2
    Then the "agent-procedure-patterns" section should grow beyond 12 default rows
    And the "agent-procedure-patterns" section should exhaust the remaining article text
    And the active page should follow the vertical rhythm
    And no browser console errors should occur

  Scenario: Article frames can shrink below default row targets
    Given I open the "height-policy-default-rows-shrink" layout scenario at 1280 by 900
    When I scroll to page 2
    Then the "agent-procedure-patterns" section should shrink below 64 default rows
    And the active continuation region should shrink to its solved blocks
    And the active page should follow the vertical rhythm
    And no browser console errors should occur

  Scenario: Sparse copy rejects oversized article furniture
    Given I open the "furniture-sufficiency-pressure" layout scenario at 1280 by 900
    When I scroll to page 3
    Then the "schools-reading-lab" section should not show a responsive image inset
    And the "market-hall" section should not show a pull quote
    And the "market-hall" section should exhaust the remaining article text
    And no continuation column should be dead
    And no solved furniture should overlap within a section
    And no measured line should overlap solved furniture
    And no browser console errors should occur

  Scenario: Wide media insets preserve image frame aspect
    Given I open the "current-edition" layout scenario at 2400 by 900
    When I scroll to page 3
    Then the "market-hall" section image should span 2 columns
    And the "market-hall" section image should be centered at the top
    And the "market-hall" section image frame should preserve its aspect ratio
    And the "market-hall" section image should leave one rhythm row before copy
    And the "market-hall" section adjacent copy should flow beside the image
    And no browser console errors should occur

  Scenario: Long image captions reserve complete rhythm rows
    Given I open the "long-image-caption" layout scenario at 2400 by 900
    When I scroll to page 3
    Then the "market-hall" section image caption should render completely
    And image captions should have no background
    And no measured line should overlap solved furniture
    And no browser console errors should occur

  Scenario: Pull quotes are omitted when the article has no editorial quote
    Given I open the "shared-continuation-no-pull-quotes" layout scenario at 1280 by 900
    Then the active content scenario should be "shared-continuation-no-pull-quotes"
    When I scroll to page 3
    Then the "schools-reading-lab" section should not show a pull quote
    And the "market-hall" section should not show a pull quote
    And no solved furniture should overlap within a section
    And no measured line should overlap solved furniture
    And no browser console errors should occur

  Scenario Outline: Article chrome does not overlap under responsive typography
    Given I open the "<scenario>" layout scenario at 1280 by 900
    Then no article chrome should overlap
    And no measured line should be cropped
    When I scroll to page 2
    Then no article chrome should overlap
    And no measured line should be cropped
    And no browser console errors should occur

    Examples:
      | scenario             |
      | current-edition      |
      | front-chrome-compact |

  Scenario: Direct article routes resolve content through the repository
    Given I open article "schools-reading-lab" at 1280 by 900
    Then the article page should show headline "Reading Labs Replace Remediation With Daily Practice"
    And the article page should show deck "Teachers are testing short, frequent literacy blocks that use live diagnostics without turning classrooms into test prep centers."
    And no browser console errors should occur
