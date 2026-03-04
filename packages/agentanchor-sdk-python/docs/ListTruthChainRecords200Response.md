# ListTruthChainRecords200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**List[TruthChainRecord]**](TruthChainRecord.md) |  | [optional] 

## Example

```python
from agentanchor.models.list_truth_chain_records200_response import ListTruthChainRecords200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListTruthChainRecords200Response from a JSON string
list_truth_chain_records200_response_instance = ListTruthChainRecords200Response.from_json(json)
# print the JSON string representation of the object
print(ListTruthChainRecords200Response.to_json())

# convert the object into a dict
list_truth_chain_records200_response_dict = list_truth_chain_records200_response_instance.to_dict()
# create an instance of ListTruthChainRecords200Response from a dict
list_truth_chain_records200_response_from_dict = ListTruthChainRecords200Response.from_dict(list_truth_chain_records200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


