Feature: Theme-aware front page redesign
  The public reader moves from the newsprint theme to a modern, theme-aware
  layout whose native medium is animated pictograms.

  Scenario: The reader chooses a theme once and keeps it
    Given a reader opens any public page for the first time
    Then the page follows the operating system light or dark setting
    When the reader picks Light, Dark or System in the header
    Then the choice is stored under "anthus-threat-intelligence-theme"
    And every public page opens in that theme without a flash of the other one
    And the Settings page offers the same three choices

  Scenario: The front page leads with the newest posts and the edition lead
    Given a published edition with desks and published posts
    When a reader opens the edition front page
    Then the header, masthead and original spiderweb mark come first
    And a strip of the four newest posts sits directly under the masthead
    And the edition hero shows the lead article with its animated pictogram
    And the edition lead is a full-width hero with a giant headline, its animated pictogram and its opening paragraph
    And the newest posts follow as large pictogram stories
    And every desk is its own hero band whose lead story has a giant headline, animated pictogram, dek and opening paragraph

  Scenario: Posts break up the edition without repeating
    Given a published edition with more desks than three
    When posts fill the latest band, the insets after every third desk and the older list
    Then no post appears twice on the page
    And a placement with no unused posts is hidden

  Scenario: Pictograms stand in for static imagery
    Given a post or article names a registered pictogram
    When it is shown on the front page or its own page
    Then the animated pictogram is drawn on the dot-grid plate in theme colors
    And it pauses while off screen
    And readers who prefer reduced motion see the resolved frame, still

  Scenario: Article pages share the new reading layout
    When a reader opens an article from an edition
    Then the article uses the same header, footer and theme tokens as the front page
    And the body reads at a 680 to 720 pixel measure with figures breaking out to the content width
    And the video edition plays above the body when the article has one
