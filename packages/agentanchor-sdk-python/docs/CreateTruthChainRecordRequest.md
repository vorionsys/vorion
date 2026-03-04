# CreateTruthChainRecordRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**record_type** | **str** |  | 
**agent_id** | **UUID** |  | [optional] 
**data** | **object** |  | 

## Example

```python
from agentanchor.models.create_truth_chain_record_request import CreateTruthChainRecordRequest

# TODO update the JSON string below
json = "{}"
# create an instance of CreateTruthChainRecordRequest from a JSON string
create_truth_chain_record_request_instance = CreateTruthChainRecordRequest.from_json(json)
# print the JSON string representation of the object
print(CreateTruthChainRecordRequest.to_json())

# convert the object into a dict
create_truth_chain_record_request_dict = create_truth_chain_record_request_instance.to_dict()
# create an instance of CreateTruthChainRecordRequest from a dict
create_truth_chain_record_request_from_dict = CreateTruthChainRecordRequest.from_dict(create_truth_chain_record_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


