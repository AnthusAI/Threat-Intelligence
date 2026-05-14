Feature: Newspaper layout scenarios
  Layout scenarios are durable examples of newspaper behavior.
  They verify both the solver's decisions and the rendered page geometry.

  Scenario: Current edition renders from the composable layout engine
    Given I open the "current-edition" layout scenario at 1280 by 900
    Then the active content scenario should be "current-edition"
    And the active content source should be "scenario"
    And the active edition should expose a composable layout plan
    And the solved layout should use 6 columns
    And the front page should label article "harbor-grid" as continued on page 2
    And the front page should label article "schools-reading-lab" as continued on page 3
    And the front page should label article "market-hall" as continued on page 3
    When I flip to page 3
    Then the active page should be a "regionStack" page
    And no measured line should be cropped
    And no solved furniture should overlap within a section
    And no measured line should overlap solved furniture
    And no continuation column should be dead
    And the "schools-reading-lab" section should show a responsive image inset
    And the "schools-reading-lab" section image should span 2 columns
    And no browser console errors should occur

  Scenario Outline: Shared continuations repair blank-column pressure
    Given I open the "shared-blank-column-pressure" layout scenario at <width> by <height>
    Then the solved layout should use <columns> columns
    When I flip to page 3
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

  Scenario: Development front page uses Markdown content by default
    Given I open the front page at 1280 by 900
    Then the active content source should be "markdown"
    And the active edition should expose a composable layout plan
    And the solved layout should use 6 columns
    And the active edition should include article "schools-reading-lab"
    When I flip to page 2
    Then the active page should be a "articlePage" page
    And the "agent-procedure-patterns" section should show a responsive image inset
    And the "agent-procedure-patterns" section image should span between 1 and 3 columns
    And no measured line should be cropped
    And no browser console errors should occur

  Scenario: Page flipping remains one page at a time
    Given I open the "current-edition" layout scenario at 1280 by 900
    When I flip to page 2
    Then the active page should be a "articlePage" page
    When I flip to page 3
    Then the active page should be a "regionStack" page
    When I flip to page 2
    Then the active page should be a "articlePage" page
    And no browser console errors should occur

  Scenario: Shared continuation uses pull quotes when they improve the fit
    Given I open the "current-edition" layout scenario at 1280 by 900
    When I flip to page 3
    Then the "schools-reading-lab" section should show a responsive pull quote
    And the "market-hall" section should show a responsive pull quote
    And no solved furniture should overlap within a section
    And no measured line should overlap solved furniture
    And no browser console errors should occur

  Scenario: Pull quotes are omitted when the article has no editorial quote
    Given I open the "shared-continuation-no-pull-quotes" layout scenario at 1280 by 900
    Then the active content scenario should be "shared-continuation-no-pull-quotes"
    When I flip to page 3
    Then the "schools-reading-lab" section should not show a pull quote
    And the "market-hall" section should not show a pull quote
    And no solved furniture should overlap within a section
    And no measured line should overlap solved furniture
    And no browser console errors should occur

  Scenario Outline: Article chrome does not overlap under responsive typography
    Given I open the "<scenario>" layout scenario at 1280 by 900
    Then no article chrome should overlap
    And no measured line should be cropped
    When I flip to page 2
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
