import unittest
from unittest import mock

from papyrus_content.graphql_authoring import PapyrusGraphQLAuthoringClient


class GraphQLGetRecordsByIdTests(unittest.TestCase):
    def test_uses_point_lookups_for_small_id_sets(self):
        client = PapyrusGraphQLAuthoringClient.__new__(PapyrusGraphQLAuthoringClient)
        with mock.patch.object(client, "get_record") as get_record, mock.patch.object(
            client, "list_records"
        ) as list_records:
            get_record.side_effect = lambda model, record_id: {"id": record_id, "model": model}
            resolved = client.get_records_by_id("Reference", ["ref-a", "ref-b"])
        self.assertEqual(
            resolved,
            {
                "ref-a": {"id": "ref-a", "model": "Reference"},
                "ref-b": {"id": "ref-b", "model": "Reference"},
            },
        )
        self.assertEqual(get_record.call_count, 2)
        list_records.assert_not_called()


if __name__ == "__main__":
    unittest.main()
