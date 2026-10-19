Feature: Theme-aware posts feed home
  The public reader is a theme-aware posts feed whose native medium is
  animated pictograms. Editions are off: the home page is the feed of
  published posts, and there are no edition date pages and no archive.

  Scenario: The reader chooses a theme once and keeps it
    Given a reader opens any public page for the first time
    Then the page follows the operating system light or dark setting
    When the reader picks Light, Dark or System in the header
    Then the choice is stored under "anthus-threat-intelligence-theme"
    And every public page opens in that theme without a flash of the other one
    And the Settings page offers the same three choices

  Scenario: The home page is the posts feed
    Given published posts
    When a reader opens the home page
    Then the header, masthead and original spiderweb mark come first
    And the newest posts follow as large pictogram stories, newest first
    And older posts follow as a dated list
    And no post appears twice on the page

  Scenario: The feed lists the publication's published articles
    Given the publication's published items are of type "article"
    When a reader opens the home page
    Then every published article appears in the feed
    And opening one shows its own page

  Scenario: The feed is empty before any post is published
    Given no published posts
    When a reader opens the home page
    Then the masthead is shown with a message that no posts have been published yet

  Scenario: Pictograms stand in for static imagery
    Given a post names a registered pictogram
    When it is shown in the feed or on its own page
    Then the animated pictogram is drawn on the dot-grid plate in theme colors
    And it pauses while off screen
    And readers who prefer reduced motion see the resolved frame, still

  Scenario: A post has its own page
    When a reader opens a post from the feed
    Then the post uses the same header, footer and theme tokens as the feed
    And the post page links back to the feed at the home page

  Scenario: Editions are off
    When a reader requests an edition date page or the archive
    Then the site answers that the page does not exist
    And the header and footer offer no edition or archive link
