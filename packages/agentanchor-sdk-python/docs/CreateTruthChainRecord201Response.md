# CreateTruthChainRecord201Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**TruthChainRecord**](TruthChainRecord.md) |  | [optional] 
**verification_url** | **str** |  | [optional] 

## Example

```python
from agentanchor.models.create_truth_chain_record201_response import CreateTruthChainRecord201Response

# TODO update the JSON string below
json = "{}"
# create an instance of CreateTruthChainRecord201Response from a JSON string
create_truth_chain_record201_response_instance = CreateTruthChainRecord201Response.from_json(json)
# print the JSON string representation of the object
print(CreateTruthChainRecord201Response.to_json())

# convert the object into a dict
create_truth_chain_record201_response_dict = create_truth_chain_record201_response_instance.to_dict()
# create an instance of CreateTruthChainRecord201Response from a dict
create_truth_chain_record201_response_from_dict = CreateTruthChainRecord201Response.from_dict(create_truth_chain_record201_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


